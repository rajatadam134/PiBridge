// make-ico.js
// Creates a proper Windows .ico file by embedding the PNG inside an ICO container.
// Modern Windows (Vista+) and Electron both support PNG-in-ICO.

const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, 'build', 'icon.png');
const icoPath = path.join(__dirname, 'build', 'icon.ico');

if (!fs.existsSync(pngPath)) {
  console.error('❌ build/icon.png not found. Please ensure the icon source exists.');
  process.exit(1);
}

const pngBuffer = fs.readFileSync(pngPath);

// ICO format: 6-byte ICONDIR header + 16-byte ICONDIRENTRY + raw PNG data
const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;
const dataOffset = ICONDIR_SIZE + ICONDIRENTRY_SIZE;

// ICONDIR header
const header = Buffer.alloc(ICONDIR_SIZE);
header.writeUInt16LE(0, 0);      // idReserved: must be 0
header.writeUInt16LE(1, 2);      // idType: 1 = ICO
header.writeUInt16LE(1, 4);      // idCount: number of images = 1

// ICONDIRENTRY for our single image
const entry = Buffer.alloc(ICONDIRENTRY_SIZE);
entry.writeUInt8(0, 0);           // bWidth:  0 means 256px
entry.writeUInt8(0, 1);           // bHeight: 0 means 256px
entry.writeUInt8(0, 2);           // bColorCount: 0 (PNG supports full color)
entry.writeUInt8(0, 3);           // bReserved
entry.writeUInt16LE(0, 4);        // wPlanes: 0 for PNG
entry.writeUInt16LE(32, 6);       // wBitCount: 32 bpp
entry.writeUInt32LE(pngBuffer.length, 8);  // dwBytesInRes: size of PNG data
entry.writeUInt32LE(dataOffset, 12);       // dwImageOffset: offset to image data

const icoBuffer = Buffer.concat([header, entry, pngBuffer]);
fs.writeFileSync(icoPath, icoBuffer);

const kb = (icoBuffer.length / 1024).toFixed(1);
console.log(`✅ build/icon.ico created successfully (${kb} KB, PNG-in-ICO format)`);
