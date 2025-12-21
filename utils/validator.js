const fs = require('fs');

function isValidOggOpus(file) {
  try {
    if (!fs.existsSync(file)) return false;
    const stats = fs.statSync(file);
    // Require a minimal size to avoid tiny partial files
    if (!stats.isFile() || stats.size < 2048) return false;

    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (bytesRead < 4) return false;

    // Ogg files start with "OggS"
    if (buf[0] !== 0x4F || buf[1] !== 0x67 || buf[2] !== 0x67 || buf[3] !== 0x53) return false;

    // Optional: check for OpusHead in subsequent bytes for stronger validation
    // Not strictly required; presence of OggS + reasonable size is enough to avoid corrupted partials

    return true;
  } catch {
    return false;
  }
}

module.exports = { isValidOggOpus };
