'use strict';
/*
 * Password hashing: PBKDF2-HMAC-SHA256 with a random per-user salt.
 * Uses the platform's WebCrypto when present and an equivalent pure-JS implementation otherwise,
 * so hashes are identical on every device and in every backup.
 */
var Crypt = (function () {
  var ITERATIONS = 60000;
  var K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  var INIT = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  var W = new Int32Array(64);

  /** One SHA-256 compression: updates state H (8 words) with message block M (16 big-endian words). */
  function compress(H, M) {
    var i, a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7], t1, t2, x;
    for (i = 0; i < 16; i++) W[i] = M[i];
    for (i = 16; i < 64; i++) {
      x = W[i - 15]; t1 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      x = W[i - 2]; t2 = ((x >>> 17) | (x << 15)) ^ ((x >>> 19) | (x << 13)) ^ (x >>> 10);
      W[i] = (W[i - 16] + t1 + W[i - 7] + t2) | 0;
    }
    for (i = 0; i < 64; i++) {
      t1 = (hh + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + hh) | 0;
  }
  function wordsToBytes(H) {
    var out = new Uint8Array(H.length * 4);
    for (var i = 0; i < H.length; i++) { out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 255; out[i * 4 + 2] = (H[i] >>> 8) & 255; out[i * 4 + 3] = H[i] & 255; }
    return out;
  }
  /** Hashes `bytes`, continuing from state `H` after `prefixLen` bytes were already consumed. */
  function finish(H, bytes, prefixLen) {
    var total = prefixLen + bytes.length;
    var padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
    padded.set(bytes); padded[bytes.length] = 0x80;
    var bits = total * 8, n = padded.length;
    padded[n - 1] = bits & 255; padded[n - 2] = (bits >>> 8) & 255; padded[n - 3] = (bits >>> 16) & 255; padded[n - 4] = (bits >>> 24) & 255;
    var M = new Int32Array(16);
    for (var off = 0; off < n; off += 64) {
      for (var i = 0; i < 16; i++) M[i] = (padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) | (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3];
      compress(H, M);
    }
    return H;
  }
  function sha256(bytes) { return wordsToBytes(finish(new Int32Array(INIT), bytes, 0)); }

  function pbkdf2JS(password, salt, iterations) {
    var key = password.length > 64 ? sha256(password) : password;
    var ipad = new Uint8Array(64), opad = new Uint8Array(64), i;
    for (i = 0; i < 64; i++) { var kb = i < key.length ? key[i] : 0; ipad[i] = kb ^ 0x36; opad[i] = kb ^ 0x5c; }
    var iState = new Int32Array(INIT), oState = new Int32Array(INIT), M = new Int32Array(16);
    function load(block) { for (var j = 0; j < 16; j++) M[j] = (block[j * 4] << 24) | (block[j * 4 + 1] << 16) | (block[j * 4 + 2] << 8) | block[j * 4 + 3]; }
    load(ipad); compress(iState, M);
    load(opad); compress(oState, M);
    // U1 = HMAC(password, salt || 00000001)
    var first = new Uint8Array(salt.length + 4);
    first.set(salt); first[salt.length + 3] = 1;
    var inner = finish(new Int32Array(iState), first, 64);
    var u = finish(new Int32Array(oState), wordsToBytes(inner), 64);
    var t = new Int32Array(u), hIn = new Int32Array(8), hOut = new Int32Array(8);
    for (var n = 1; n < iterations; n++) {
      // Each further round is exactly two compressions: the 32-byte value plus fixed padding fits one block.
      for (i = 0; i < 8; i++) { M[i] = u[i]; hIn[i] = iState[i]; }
      M[8] = 0x80000000 | 0; M[9] = M[10] = M[11] = M[12] = M[13] = M[14] = 0; M[15] = 768;
      compress(hIn, M);
      for (i = 0; i < 8; i++) { M[i] = hIn[i]; hOut[i] = oState[i]; }
      M[8] = 0x80000000 | 0; M[9] = M[10] = M[11] = M[12] = M[13] = M[14] = 0; M[15] = 768;
      compress(hOut, M);
      for (i = 0; i < 8; i++) { u[i] = hOut[i]; t[i] ^= hOut[i]; }
    }
    return wordsToBytes(t);
  }

  function pbkdf2(password, salt, iterations, forceJS) {
    var subtle = typeof crypto !== 'undefined' && crypto.subtle;
    if (subtle && !forceJS) {
      try {
        return subtle.importKey('raw', password, { name: 'PBKDF2' }, false, ['deriveBits']).then(function (key) {
          return subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' }, key, 256);
        }).then(function (bits) { return new Uint8Array(bits); }).catch(function () { return pbkdf2JS(password, salt, iterations); });
      } catch (e) { /* fall through */ }
    }
    return new Promise(function (resolve) { setTimeout(function () { resolve(pbkdf2JS(password, salt, iterations)); }, 10); });
  }

  function randomBytes(n) {
    var b = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return b;
  }

  /** Returns {salt, hash, iter} (hex strings) for storing with the user record. */
  function hashPassword(password) {
    var salt = randomBytes(16);
    return pbkdf2(U.utf8(password), salt, ITERATIONS).then(function (hash) {
      return { salt: U.hex(salt), hash: U.hex(hash), iter: ITERATIONS };
    });
  }
  function verifyPassword(password, user) {
    return pbkdf2(U.utf8(password), U.unhex(user.salt), user.iter || ITERATIONS).then(function (hash) {
      var a = U.hex(hash), b = user.hash || '', diff = a.length ^ b.length;
      for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % (b.length || 1));
      return diff === 0;
    });
  }

  return { ITERATIONS: ITERATIONS, sha256: sha256, pbkdf2: pbkdf2, pbkdf2JS: pbkdf2JS, hashPassword: hashPassword, verifyPassword: verifyPassword };
})();
