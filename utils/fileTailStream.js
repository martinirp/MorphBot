const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

function createOpusTailStream(finalPath) {
  const partPath = `${finalPath}.part`;
  const out = new PassThrough({ highWaterMark: 64 * 1024 });

  let currentPath = fs.existsSync(finalPath) ? finalPath : (fs.existsSync(partPath) ? partPath : null);
  if (!currentPath) {
    process.nextTick(() => out.emit('error', new Error('No cache file available to tail')));
    return out;
  }

  let fd = null;
  let offset = 0;
  let closed = false;
  let started = false; // only begin writing after valid Ogg header detected
  let lastLogged = 0;
  let lastReadTime = Date.now();
  const INACTIVITY_TIMEOUT = 30000; // 30s sem novos bytes = timeout
  const nameForLog = path.basename(finalPath);

  const openHandle = (p) => {
    if (fd) { try { fs.closeSync(fd); } catch {} }
    try {
      fd = fs.openSync(p, 'r');
      currentPath = p;
      console.log(`[TAIL] open path=${p} file=${nameForLog} offset=${offset}`);
    } catch (err) {
      out.emit('error', err);
    }
  };

  openHandle(currentPath);

  const readLoop = async () => {
    while (!closed) {
      // Check for inactivity timeout
      if (Date.now() - lastReadTime > INACTIVITY_TIMEOUT) {
        console.warn(`[TAIL] timeout: sem novos bytes há 30s file=${nameForLog}`);
        out.emit('error', new Error('Tail stream timeout: no data received'));
        break;
      }
      try {
        const targetPath = fs.existsSync(finalPath) ? finalPath : (fs.existsSync(partPath) ? partPath : null);
        if (!targetPath) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
        if (targetPath !== currentPath) {
          const prevPath = currentPath;
          console.log(`[TAIL] switch detected: ${path.basename(prevPath)} -> ${path.basename(targetPath)} offset=${offset}`);
          // Reopen handle; offset stays same (rename operation)
          openHandle(targetPath);
          // Verify offset is still valid for new handle
          const statAfterSwitch = fs.statSync(targetPath);
          if (offset > statAfterSwitch.size) {
            console.warn(`[TAIL] offset ${offset} > filesize ${statAfterSwitch.size} after switch, resetting to size`);
            offset = statAfterSwitch.size;
          }
        }
        const stat = fs.statSync(targetPath);
        const available = stat.size - offset;
        if (available > 0) {
          const toRead = Math.min(64 * 1024, available);
          const buf = Buffer.allocUnsafe(toRead);
          const bytesRead = fs.readSync(fd, buf, 0, toRead, offset);
          if (bytesRead > 0) {
            // Before first write, ensure OggS header at file start
            if (!started) {
              try {
                const hdr = Buffer.alloc(4);
                const hdrRead = fs.readSync(fd, hdr, 0, 4, 0);
                if (hdrRead === 4 && hdr[0] === 0x4F && hdr[1] === 0x67 && hdr[2] === 0x67 && hdr[3] === 0x53) {
                  started = true;
                  console.log(`[TAIL] header OK file=${nameForLog}`);
                } else {
                  // wait until header is present
                  await new Promise(r => setTimeout(r, 100));
                  continue;
                }
              } catch {}
            }

            offset += bytesRead;
            lastReadTime = Date.now(); // reset timeout on successful read
            const shouldContinue = out.write(buf.subarray(0, bytesRead));
            if (!shouldContinue) {
              await new Promise(r => out.once('drain', r));
            }
            if (process.env.DEBUG_MODE === 'true' && offset - lastLogged >= 256 * 1024) {
              lastLogged = offset;
              console.log(`[TAIL] progress file=${nameForLog} offset=${offset}`);
            }
          } else {
            await new Promise(r => setTimeout(r, 50));
          }
        } else {
          if (targetPath === finalPath) {
            // Grace period to ensure writer finished
            await new Promise(r => setTimeout(r, 200));
            const finalStat = fs.statSync(finalPath);
            if (finalStat.size === offset) {
              break;
            }
          }
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (err) {
        // During rename or transient errors, wait and retry
        await new Promise(r => setTimeout(r, 100));
      }
    }
    try { if (fd) fs.closeSync(fd); } catch {}
    console.log(`[TAIL] end file=${nameForLog} totalBytes=${offset} final=${currentPath === finalPath}`);
    out.end();
  };

  out.on('close', () => {
    closed = true;
    try { if (fd) fs.closeSync(fd); } catch {}
  });

  setImmediate(() => { readLoop(); });

  return out;
}

module.exports = { createOpusTailStream };
