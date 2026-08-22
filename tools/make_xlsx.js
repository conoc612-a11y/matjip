/**
 * 의존성 없는 최소 XLSX 작성기.
 *
 * 왜 직접 쓰나: 이 저장소에는 엑셀 라이브러리가 없다(package.json 확인). 개인 참고자료 하나를
 * 내보내려고 sheetjs/exceljs 를 의존성에 넣는 것은 과하다. xlsx 는 결국 **XML 몇 장을 담은 ZIP**
 * 이라 표준 라이브러리(zlib 도 필요 없다)만으로 만들 수 있다.
 *
 * 쓰는 법:
 *   const { writeXlsx } = require('./make_xlsx');
 *   writeXlsx('out.xlsx', [
 *     { name: '요약', rows: [['구분','건수'], ['활용 중', 17]] },
 *     { name: '활용중', rows: [...] },
 *   ]);
 *
 * 설계 메모:
 *  - 압축하지 않는다(ZIP method 0 = STORE). 파일이 몇 KB 라 이득이 없고, deflate 를 쓰면
 *    압축 크기·CRC 를 맞추다 틀릴 여지만 생긴다. 엑셀은 STORE 를 정상으로 읽는다.
 *  - 문자열은 inlineStr 로 넣는다 → sharedStrings.xml 을 만들지 않아도 된다.
 *  - 숫자는 숫자 셀로, 나머지는 문자열로 넣는다. 날짜 서식은 다루지 않는다(필요해지면 추가).
 *  - 시트 이름은 엑셀 제약을 따라 정리한다: 31자 이하, : \ / ? * [ ] 금지.
 */

const fs = require('fs');

// ── CRC32 (ZIP 이 요구한다) ──
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── ZIP (STORE) ──
function zip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);   // local file header signature
    lh.writeUInt16LE(20, 4);           // version needed
    lh.writeUInt16LE(0x0800, 6);       // flags: UTF-8 파일명
    lh.writeUInt16LE(0, 8);            // method 0 = STORE
    lh.writeUInt16LE(0, 10);           // time
    lh.writeUInt16LE(0, 12);           // date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);   // central directory signature
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // 엑셀은 XML 1.0 이 금지한 제어문자를 담은 파일을 '손상됨'으로 본다 → 미리 걷어낸다.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

const colName = (n) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

function sheetXml(rows) {
  const body = rows.map((row, ri) => {
    const cells = row.map((v, ci) => {
      const ref = colName(ci + 1) + (ri + 1);
      if (v == null || v === '') return '';
      if (typeof v === 'number' && Number.isFinite(v)) {
        return `<c r="${ref}"><v>${v}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData>${body}</sheetData></worksheet>`;
}

// 엑셀 시트 이름 제약: 31자 이하, : \ / ? * [ ] 금지, 빈 이름 불가, 중복 불가.
function safeSheetName(name, used) {
  let s = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet';
  let base = s, i = 2;
  while (used.has(s)) { const suf = '_' + i++; s = base.slice(0, 31 - suf.length) + suf; }
  used.add(s);
  return s;
}

function writeXlsx(outPath, sheets) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('시트가 최소 하나 필요하다');
  const used = new Set();
  const named = sheets.map((s) => ({ name: safeSheetName(s.name, used), rows: s.rows || [] }));

  const files = [
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '</Types>',
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
        + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + '</Relationships>',
    },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) })),
  ];

  fs.writeFileSync(outPath, zip(files));
  return outPath;
}

module.exports = { writeXlsx };
