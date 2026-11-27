import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/pend/index.js
var require_pend = __commonJS({
  "node_modules/pend/index.js"(exports, module) {
    module.exports = Pend;
    function Pend() {
      this.pending = 0;
      this.max = Infinity;
      this.listeners = [];
      this.waiting = [];
      this.error = null;
    }
    Pend.prototype.go = function(fn) {
      if (this.pending < this.max) {
        pendGo(this, fn);
      } else {
        this.waiting.push(fn);
      }
    };
    Pend.prototype.wait = function(cb) {
      if (this.pending === 0) {
        cb(this.error);
      } else {
        this.listeners.push(cb);
      }
    };
    Pend.prototype.hold = function() {
      return pendHold(this);
    };
    function pendHold(self) {
      self.pending += 1;
      var called = false;
      return onCb;
      function onCb(err) {
        if (called) throw new Error("callback called twice");
        called = true;
        self.error = self.error || err;
        self.pending -= 1;
        if (self.waiting.length > 0 && self.pending < self.max) {
          pendGo(self, self.waiting.shift());
        } else if (self.pending === 0) {
          var listeners = self.listeners;
          self.listeners = [];
          listeners.forEach(cbListener);
        }
      }
      function cbListener(listener) {
        listener(self.error);
      }
    }
    function pendGo(self, fn) {
      fn(pendHold(self));
    }
  }
});

// node_modules/yauzl/fd-slicer.js
var require_fd_slicer = __commonJS({
  "node_modules/yauzl/fd-slicer.js"(exports) {
    var fs = __require("fs");
    var util = __require("util");
    var stream = __require("stream");
    var Readable = stream.Readable;
    var PassThrough = stream.PassThrough;
    var Pend = require_pend();
    var EventEmitter = __require("events").EventEmitter;
    exports.BufferSlicer = BufferSlicer;
    exports.FdSlicer = FdSlicer;
    util.inherits(FdSlicer, EventEmitter);
    function FdSlicer(fd) {
      EventEmitter.call(this);
      this.fd = fd;
      this.pend = new Pend();
      this.pend.max = 1;
      this.refCount = 0;
    }
    FdSlicer.prototype.read = function(buffer, offset, length, position, callback) {
      var self = this;
      self.pend.go(function(cb) {
        fs.read(self.fd, buffer, offset, length, position, function(err, bytesRead, buffer2) {
          cb();
          callback(err, bytesRead, buffer2);
        });
      });
    };
    FdSlicer.prototype.createReadStream = function(options2) {
      return new ReadStream(this, options2);
    };
    FdSlicer.prototype.ref = function() {
      this.refCount += 1;
    };
    FdSlicer.prototype.unref = function() {
      var self = this;
      self.refCount -= 1;
      if (self.refCount < 0) throw new Error("invalid unref");
      if (self.refCount > 0) return;
      fs.close(self.fd, onCloseDone);
      function onCloseDone(err) {
        if (err) {
          self.emit("error", err);
        } else {
          self.emit("close");
        }
      }
    };
    util.inherits(ReadStream, Readable);
    function ReadStream(context, options2) {
      options2 = options2 || {};
      Readable.call(this, options2);
      this.context = context;
      this.context.ref();
      this.start = options2.start || 0;
      this.endOffset = options2.end;
      this.pos = this.start;
    }
    ReadStream.prototype._read = function(n) {
      var self = this;
      var toRead = Math.min(self._readableState.highWaterMark, n);
      if (self.endOffset != null) {
        toRead = Math.min(toRead, self.endOffset - self.pos);
      }
      if (toRead <= 0) {
        self.push(null);
        this._cleanup();
        return;
      }
      self.context.pend.go(function(cb) {
        var buffer = Buffer.allocUnsafe(toRead);
        fs.read(self.context.fd, buffer, 0, toRead, self.pos, function(err, bytesRead) {
          if (err) {
            self.destroy(err);
          } else if (bytesRead === 0) {
            self.push(null);
            self._cleanup();
          } else {
            self.pos += bytesRead;
            self.push(buffer.slice(0, bytesRead));
          }
          cb();
        });
      });
    };
    ReadStream.prototype._destroy = function(err, cb) {
      this._cleanup();
      cb(err);
    };
    ReadStream.prototype._cleanup = function() {
      if (this.context != null) {
        this.context.unref();
        this.context = null;
      }
    };
    util.inherits(BufferSlicer, EventEmitter);
    function BufferSlicer(buffer) {
      EventEmitter.call(this);
      this.refCount = 0;
      this.buffer = buffer;
    }
    BufferSlicer.prototype.read = function(buffer, offset, length, position, callback) {
      if (!(0 <= offset && offset <= buffer.length)) throw new RangeError("offset outside buffer: 0 <= " + offset + " <= " + buffer.length);
      if (position < 0) throw new RangeError("position is negative: " + position);
      if (offset + length > buffer.length) {
        length = buffer.length - offset;
      }
      if (position + length > this.buffer.length) {
        length = this.buffer.length - position;
      }
      if (length <= 0) {
        setImmediate(function() {
          callback(null, 0);
        });
        return;
      }
      this.buffer.copy(buffer, offset, position, position + length);
      setImmediate(function() {
        callback(null, length);
      });
    };
    BufferSlicer.prototype.createReadStream = function(options2) {
      options2 = options2 || {};
      var readStream = new PassThrough(options2);
      readStream.start = options2.start || 0;
      readStream.endOffset = options2.end;
      readStream.pos = readStream.endOffset || this.buffer.length;
      var entireSlice = this.buffer.slice(readStream.start, readStream.pos);
      var maxChunkSize = 65536;
      var offset = 0;
      while (true) {
        var nextOffset = offset + maxChunkSize;
        if (nextOffset >= entireSlice.length) {
          if (offset < entireSlice.length) {
            readStream.write(entireSlice.slice(offset, entireSlice.length));
          }
          break;
        }
        readStream.write(entireSlice.slice(offset, nextOffset));
        offset = nextOffset;
      }
      readStream.end();
      return readStream;
    };
    BufferSlicer.prototype.ref = function() {
      this.refCount += 1;
    };
    BufferSlicer.prototype.unref = function() {
      this.refCount -= 1;
      if (this.refCount < 0) {
        throw new Error("invalid unref");
      }
    };
  }
});

// node_modules/yauzl/crc32.js
var require_crc32 = __commonJS({
  "node_modules/yauzl/crc32.js"(exports, module) {
    var CRC_TABLE = new Int32Array([
      0,
      1996959894,
      3993919788,
      2567524794,
      124634137,
      1886057615,
      3915621685,
      2657392035,
      249268274,
      2044508324,
      3772115230,
      2547177864,
      162941995,
      2125561021,
      3887607047,
      2428444049,
      498536548,
      1789927666,
      4089016648,
      2227061214,
      450548861,
      1843258603,
      4107580753,
      2211677639,
      325883990,
      1684777152,
      4251122042,
      2321926636,
      335633487,
      1661365465,
      4195302755,
      2366115317,
      997073096,
      1281953886,
      3579855332,
      2724688242,
      1006888145,
      1258607687,
      3524101629,
      2768942443,
      901097722,
      1119000684,
      3686517206,
      2898065728,
      853044451,
      1172266101,
      3705015759,
      2882616665,
      651767980,
      1373503546,
      3369554304,
      3218104598,
      565507253,
      1454621731,
      3485111705,
      3099436303,
      671266974,
      1594198024,
      3322730930,
      2970347812,
      795835527,
      1483230225,
      3244367275,
      3060149565,
      1994146192,
      31158534,
      2563907772,
      4023717930,
      1907459465,
      112637215,
      2680153253,
      3904427059,
      2013776290,
      251722036,
      2517215374,
      3775830040,
      2137656763,
      141376813,
      2439277719,
      3865271297,
      1802195444,
      476864866,
      2238001368,
      4066508878,
      1812370925,
      453092731,
      2181625025,
      4111451223,
      1706088902,
      314042704,
      2344532202,
      4240017532,
      1658658271,
      366619977,
      2362670323,
      4224994405,
      1303535960,
      984961486,
      2747007092,
      3569037538,
      1256170817,
      1037604311,
      2765210733,
      3554079995,
      1131014506,
      879679996,
      2909243462,
      3663771856,
      1141124467,
      855842277,
      2852801631,
      3708648649,
      1342533948,
      654459306,
      3188396048,
      3373015174,
      1466479909,
      544179635,
      3110523913,
      3462522015,
      1591671054,
      702138776,
      2966460450,
      3352799412,
      1504918807,
      783551873,
      3082640443,
      3233442989,
      3988292384,
      2596254646,
      62317068,
      1957810842,
      3939845945,
      2647816111,
      81470997,
      1943803523,
      3814918930,
      2489596804,
      225274430,
      2053790376,
      3826175755,
      2466906013,
      167816743,
      2097651377,
      4027552580,
      2265490386,
      503444072,
      1762050814,
      4150417245,
      2154129355,
      426522225,
      1852507879,
      4275313526,
      2312317920,
      282753626,
      1742555852,
      4189708143,
      2394877945,
      397917763,
      1622183637,
      3604390888,
      2714866558,
      953729732,
      1340076626,
      3518719985,
      2797360999,
      1068828381,
      1219638859,
      3624741850,
      2936675148,
      906185462,
      1090812512,
      3747672003,
      2825379669,
      829329135,
      1181335161,
      3412177804,
      3160834842,
      628085408,
      1382605366,
      3423369109,
      3138078467,
      570562233,
      1426400815,
      3317316542,
      2998733608,
      733239954,
      1555261956,
      3268935591,
      3050360625,
      752459403,
      1541320221,
      2607071920,
      3965973030,
      1969922972,
      40735498,
      2617837225,
      3943577151,
      1913087877,
      83908371,
      2512341634,
      3803740692,
      2075208622,
      213261112,
      2463272603,
      3855990285,
      2094854071,
      198958881,
      2262029012,
      4057260610,
      1759359992,
      534414190,
      2176718541,
      4139329115,
      1873836001,
      414664567,
      2282248934,
      4279200368,
      1711684554,
      285281116,
      2405801727,
      4167216745,
      1634467795,
      376229701,
      2685067896,
      3608007406,
      1308918612,
      956543938,
      2808555105,
      3495958263,
      1231636301,
      1047427035,
      2932959818,
      3654703836,
      1088359270,
      936918e3,
      2847714899,
      3736837829,
      1202900863,
      817233897,
      3183342108,
      3401237130,
      1404277552,
      615818150,
      3134207493,
      3453421203,
      1423857449,
      601450431,
      3009837614,
      3294710456,
      1567103746,
      711928724,
      3020668471,
      3272380065,
      1510334235,
      755167117
    ]);
    function crc32(buf) {
      let crc = -1;
      for (let x of buf) {
        crc = CRC_TABLE[(crc ^ x) & 255] ^ crc >>> 8;
      }
      return (crc ^ -1) >>> 0;
    }
    module.exports = crc32;
  }
});

// node_modules/yauzl/index.js
var require_yauzl = __commonJS({
  "node_modules/yauzl/index.js"(exports) {
    var fs = __require("fs");
    var zlib = __require("zlib");
    var fd_slicer = require_fd_slicer();
    var util = __require("util");
    var EventEmitter = __require("events").EventEmitter;
    var Transform = __require("stream").Transform;
    var PassThrough = __require("stream").PassThrough;
    var Writable = __require("stream").Writable;
    var crc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : require_crc32();
    exports.open = open;
    exports.fromFd = fromFd;
    exports.fromBuffer = fromBuffer;
    exports.fromRandomAccessReader = fromRandomAccessReader;
    exports.openPromise = openPromise;
    exports.fromFdPromise = fromFdPromise;
    exports.fromBufferPromise = fromBufferPromise;
    exports.fromRandomAccessReaderPromise = fromRandomAccessReaderPromise;
    exports.dosDateTimeToDate = dosDateTimeToDate;
    exports.getFileNameLowLevel = getFileNameLowLevel;
    exports.validateFileName = validateFileName;
    exports.parseExtraFields = parseExtraFields;
    exports.ZipFile = ZipFile;
    exports.Entry = Entry;
    exports.LocalFileHeader = LocalFileHeader;
    exports.RandomAccessReader = RandomAccessReader;
    function openPromise(path2, options2) {
      return new Promise((resolve, reject) => {
        open(path2, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function fromFdPromise(fd, options2) {
      return new Promise((resolve, reject) => {
        fromFd(fd, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function fromBufferPromise(buffer, options2) {
      return new Promise((resolve, reject) => {
        fromBuffer(buffer, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function fromRandomAccessReaderPromise(reader, totalSize, options2) {
      return new Promise((resolve, reject) => {
        fromRandomAccessReader(reader, totalSize, { ...options2, lazyEntries: true }, function(err, zipfile) {
          if (err) return reject(err);
          resolve(zipfile);
        });
      });
    }
    function open(path2, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = true;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      fs.open(path2, "r", function(err, fd) {
        if (err) return callback(err);
        fromFd(fd, options2, function(err2, zipfile) {
          if (err2) fs.close(fd, defaultCallback);
          callback(err2, zipfile);
        });
      });
    }
    function fromFd(fd, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = false;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      fs.fstat(fd, function(err, stats) {
        if (err) return callback(err);
        var reader = new fd_slicer.FdSlicer(fd);
        fromRandomAccessReader(reader, stats.size, options2, callback);
      });
    }
    function fromBuffer(buffer, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      options2.autoClose = false;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      var reader = new fd_slicer.BufferSlicer(buffer);
      fromRandomAccessReader(reader, buffer.length, options2, callback);
    }
    function fromRandomAccessReader(reader, totalSize, options2, callback) {
      if (typeof options2 === "function") {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      if (options2.autoClose == null) options2.autoClose = true;
      if (options2.lazyEntries == null) options2.lazyEntries = false;
      if (options2.decodeStrings == null) options2.decodeStrings = true;
      var decodeStrings = !!options2.decodeStrings;
      if (options2.validateEntrySizes == null) options2.validateEntrySizes = true;
      if (options2.strictFileNames == null) options2.strictFileNames = false;
      if (callback == null) callback = defaultCallback;
      if (typeof totalSize !== "number") throw new Error("expected totalSize parameter to be a number");
      if (totalSize > Number.MAX_SAFE_INTEGER) {
        throw new Error("zip file too large. only file sizes up to 2^52 are supported due to JavaScript's Number type being an IEEE 754 double.");
      }
      reader.ref();
      var eocdrWithoutCommentSize = 22;
      var zip64EocdlSize = 20;
      var maxCommentSize = 65535;
      var bufferSize = Math.min(zip64EocdlSize + eocdrWithoutCommentSize + maxCommentSize, totalSize);
      var buffer = newBuffer(bufferSize);
      var bufferReadStart = totalSize - buffer.length;
      readAndAssertNoEof(reader, buffer, 0, bufferSize, bufferReadStart, function(err) {
        if (err) return callback(err);
        for (var i = bufferSize - eocdrWithoutCommentSize; i >= 0; i -= 1) {
          if (buffer.readUInt32LE(i) !== 101010256) continue;
          var eocdrBuffer = buffer.subarray(i);
          var diskNumber = eocdrBuffer.readUInt16LE(4);
          var entryCount = eocdrBuffer.readUInt16LE(10);
          var centralDirectoryOffset = eocdrBuffer.readUInt32LE(16);
          var commentLength = eocdrBuffer.readUInt16LE(20);
          var expectedCommentLength = eocdrBuffer.length - eocdrWithoutCommentSize;
          if (commentLength !== expectedCommentLength) {
            return callback(new Error("Invalid comment length. Expected: " + expectedCommentLength + ". Found: " + commentLength + ". Are there extra bytes at the end of the file? Or is the end of central dir signature `PK\u263A\u263B` in the comment?"));
          }
          var comment = decodeStrings ? decodeBuffer(eocdrBuffer.subarray(22), false) : eocdrBuffer.subarray(22);
          if (i - zip64EocdlSize >= 0 && buffer.readUInt32LE(i - zip64EocdlSize) === 117853008) {
            var zip64EocdlBuffer = buffer.subarray(i - zip64EocdlSize, i - zip64EocdlSize + zip64EocdlSize);
            var zip64EocdrOffset = readUInt64LE(zip64EocdlBuffer, 8);
            var zip64EocdrBuffer = newBuffer(56);
            return readAndAssertNoEof(reader, zip64EocdrBuffer, 0, zip64EocdrBuffer.length, zip64EocdrOffset, function(err2) {
              if (err2) return callback(err2);
              if (zip64EocdrBuffer.readUInt32LE(0) !== 101075792) {
                return callback(new Error("invalid zip64 end of central directory record signature"));
              }
              diskNumber = zip64EocdrBuffer.readUInt32LE(16);
              if (diskNumber !== 0) {
                return callback(new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
              }
              entryCount = readUInt64LE(zip64EocdrBuffer, 32);
              centralDirectoryOffset = readUInt64LE(zip64EocdrBuffer, 48);
              return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options2.autoClose, options2.lazyEntries, decodeStrings, options2.validateEntrySizes, options2.strictFileNames));
            });
          }
          if (diskNumber !== 0) {
            return callback(new Error("multi-disk zip files are not supported: found disk number: " + diskNumber));
          }
          return callback(null, new ZipFile(reader, centralDirectoryOffset, totalSize, entryCount, comment, options2.autoClose, options2.lazyEntries, decodeStrings, options2.validateEntrySizes, options2.strictFileNames));
        }
        callback(new Error("End of central directory record signature not found. Either not a zip file, or file is truncated."));
      });
    }
    util.inherits(ZipFile, EventEmitter);
    function ZipFile(reader, centralDirectoryOffset, fileSize, entryCount, comment, autoClose, lazyEntries, decodeStrings, validateEntrySizes, strictFileNames) {
      var self = this;
      EventEmitter.call(self);
      self.reader = reader;
      self.reader.on("error", function(err) {
        emitError(self, err);
      });
      self.reader.once("close", function() {
        self.emit("close");
      });
      self.readEntryCursor = centralDirectoryOffset;
      self.fileSize = fileSize;
      self.entryCount = entryCount;
      self.comment = comment;
      self.entriesRead = 0;
      self.autoClose = !!autoClose;
      self.lazyEntries = !!lazyEntries;
      self.decodeStrings = !!decodeStrings;
      self.validateEntrySizes = !!validateEntrySizes;
      self.strictFileNames = !!strictFileNames;
      self.isOpen = true;
      self.emittedError = false;
      self.hasEachEntryBeenCalled = false;
      if (!self.lazyEntries) self._readEntry();
    }
    ZipFile.prototype.close = function() {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.reader.unref();
    };
    function emitErrorAndAutoClose(self, err) {
      if (self.autoClose) self.close();
      emitError(self, err);
    }
    function emitError(self, err) {
      if (self.emittedError) return;
      self.emittedError = true;
      self.emit("error", err);
    }
    ZipFile.prototype.readEntry = function() {
      if (!this.lazyEntries) throw new Error("readEntry() called without lazyEntries:true");
      this._readEntry();
    };
    ZipFile.prototype._readEntry = function() {
      var self = this;
      if (self.entryCount === self.entriesRead) {
        setImmediate(function() {
          if (self.autoClose) self.close();
          if (self.emittedError) return;
          self.emit("end");
        });
        return;
      }
      if (self.emittedError) return;
      var buffer = newBuffer(46);
      readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err) {
        if (err) return emitErrorAndAutoClose(self, err);
        if (self.emittedError) return;
        var entry = new Entry();
        var signature = buffer.readUInt32LE(0);
        if (signature !== 33639248) return emitErrorAndAutoClose(self, new Error("invalid central directory file header signature: 0x" + signature.toString(16)));
        entry.versionMadeBy = buffer.readUInt16LE(4);
        entry.versionNeededToExtract = buffer.readUInt16LE(6);
        entry.generalPurposeBitFlag = buffer.readUInt16LE(8);
        entry.compressionMethod = buffer.readUInt16LE(10);
        entry.lastModFileTime = buffer.readUInt16LE(12);
        entry.lastModFileDate = buffer.readUInt16LE(14);
        entry.crc32 = buffer.readUInt32LE(16);
        entry.compressedSize = buffer.readUInt32LE(20);
        entry.uncompressedSize = buffer.readUInt32LE(24);
        entry.fileNameLength = buffer.readUInt16LE(28);
        entry.extraFieldLength = buffer.readUInt16LE(30);
        entry.fileCommentLength = buffer.readUInt16LE(32);
        entry.internalFileAttributes = buffer.readUInt16LE(36);
        entry.externalFileAttributes = buffer.readUInt32LE(38);
        entry.relativeOffsetOfLocalHeader = buffer.readUInt32LE(42);
        if (entry.generalPurposeBitFlag & 64) return emitErrorAndAutoClose(self, new Error("strong encryption is not supported"));
        self.readEntryCursor += 46;
        buffer = newBuffer(entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength);
        readAndAssertNoEof(self.reader, buffer, 0, buffer.length, self.readEntryCursor, function(err2) {
          if (err2) return emitErrorAndAutoClose(self, err2);
          if (self.emittedError) return;
          entry.fileNameRaw = buffer.subarray(0, entry.fileNameLength);
          var fileCommentStart = entry.fileNameLength + entry.extraFieldLength;
          entry.extraFieldRaw = buffer.subarray(entry.fileNameLength, fileCommentStart);
          entry.fileCommentRaw = buffer.subarray(fileCommentStart, fileCommentStart + entry.fileCommentLength);
          try {
            entry.extraFields = parseExtraFields(entry.extraFieldRaw);
          } catch (err3) {
            return emitErrorAndAutoClose(self, err3);
          }
          if (self.decodeStrings) {
            var isUtf8 = (entry.generalPurposeBitFlag & 2048) !== 0;
            entry.fileComment = decodeBuffer(entry.fileCommentRaw, isUtf8);
            entry.fileName = getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, self.strictFileNames);
            var errorMessage = validateFileName(entry.fileName);
            if (errorMessage != null) return emitErrorAndAutoClose(self, new Error(errorMessage));
          } else {
            entry.fileComment = entry.fileCommentRaw;
            entry.fileName = entry.fileNameRaw;
          }
          entry.comment = entry.fileComment;
          self.readEntryCursor += buffer.length;
          self.entriesRead += 1;
          for (var i = 0; i < entry.extraFields.length; i++) {
            var extraField = entry.extraFields[i];
            if (extraField.id !== 1) continue;
            var zip64EiefBuffer = extraField.data;
            var index = 0;
            if (entry.uncompressedSize === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include uncompressed size"));
              }
              entry.uncompressedSize = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            if (entry.compressedSize === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include compressed size"));
              }
              entry.compressedSize = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            if (entry.relativeOffsetOfLocalHeader === 4294967295) {
              if (index + 8 > zip64EiefBuffer.length) {
                return emitErrorAndAutoClose(self, new Error("zip64 extended information extra field does not include relative header offset"));
              }
              entry.relativeOffsetOfLocalHeader = readUInt64LE(zip64EiefBuffer, index);
              index += 8;
            }
            break;
          }
          if (self.validateEntrySizes && entry.compressionMethod === 0) {
            var expectedCompressedSize = entry.uncompressedSize;
            if (entry.isEncrypted()) {
              expectedCompressedSize += 12;
            }
            if (entry.compressedSize !== expectedCompressedSize) {
              var msg = "compressed/uncompressed size mismatch for stored file: " + entry.compressedSize + " != " + entry.uncompressedSize;
              return emitErrorAndAutoClose(self, new Error(msg));
            }
          }
          self.emit("entry", entry);
          if (!self.lazyEntries) self._readEntry();
        });
      });
    };
    ZipFile.prototype.eachEntry = function() {
      const self = this;
      if (!self.lazyEntries) throw new Error("eachEntry() requires lazyEntries: true");
      if (self.hasEachEntryBeenCalled) throw new Error("eachEntry() must only be called once per ZipFile");
      self.hasEachEntryBeenCalled = true;
      let pendingResolveReject = null;
      self.on("entry", onEntry);
      self.on("end", onEnd);
      self.on("error", onError);
      function cleanup() {
        self.removeListener("entry", onEntry);
        self.removeListener("end", onEnd);
        self.removeListener("error", onError);
        if (self.autoClose) self.close();
      }
      function onEntry(entry) {
        let { resolve } = pendingResolveReject;
        pendingResolveReject = null;
        resolve({ value: entry });
      }
      function onEnd() {
        let { resolve } = pendingResolveReject;
        pendingResolveReject = null;
        cleanup();
        resolve({ done: true });
      }
      function onError(err) {
        let { reject } = pendingResolveReject;
        pendingResolveReject = null;
        cleanup();
        reject(err);
      }
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          const promise = new Promise((resolve, reject) => {
            if (pendingResolveReject != null) throw new Error("next() called before previous Promise was resolved.");
            pendingResolveReject = { resolve, reject };
          });
          self.readEntry();
          return promise;
        },
        return(value) {
          cleanup();
          return Promise.resolve({ done: true, value });
        },
        throw(value) {
          cleanup();
          return Promise.reject(value);
        }
      };
    };
    ZipFile.prototype.openReadStream = function(entry, options2, callback) {
      var self = this;
      var relativeStart = 0;
      var relativeEnd = entry.compressedSize;
      if (callback == null) {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) {
        options2 = {};
      } else {
        if (options2.decodeFileData === false) {
          if (options2.decrypt != null) {
            throw new Error("cannot use options.decrypt when options.decodeFileData === false");
          }
          if (options2.decompress != null) {
            throw new Error("cannot use options.decompress when options.decodeFileData === false");
          }
        } else {
          if (options2.decrypt != null) {
            if (!entry.isEncrypted()) {
              throw new Error("options.decrypt can only be specified for encrypted entries. See also option decodeFileData.");
            }
            if (options2.decrypt !== false) throw new Error("invalid options.decrypt value: " + options2.decrypt);
            if (entry.isCompressed()) {
              if (options2.decompress !== false) throw new Error("entry is encrypted and compressed, and options.decompress !== false. See also option decodeFileData.");
            }
          }
          if (options2.decompress != null) {
            if (!entry.isCompressed()) {
              throw new Error("options.decompress can only be specified for compressed entries. See also option decodeFileData.");
            }
            if (!(options2.decompress === false || options2.decompress === true)) {
              throw new Error("invalid options.decompress value: " + options2.decompress);
            }
            decompress = options2.decompress;
          }
        }
        if (options2.start != null) {
          relativeStart = options2.start;
          if (relativeStart < 0) throw new Error("options.start < 0");
          if (relativeStart > entry.compressedSize) throw new Error("options.start > entry.compressedSize");
        }
        if (options2.end != null) {
          relativeEnd = options2.end;
          if (relativeEnd < 0) throw new Error("options.end < 0");
          if (relativeEnd > entry.compressedSize) throw new Error("options.end > entry.compressedSize");
          if (relativeEnd < relativeStart) throw new Error("options.end < options.start");
        }
      }
      var rawMode = options2.decodeFileData === false || // Explicitly requested raw.
      (entry.compressionMethod === 0 || // Naturally without compression.
      entry.compressionMethod === 8 && options2.decompress === false) && (!entry.isEncrypted() || // Naturally without encryption.
      options2.decrypt === false);
      if (options2.start != null || options2.end != null) {
        if (!rawMode) throw new Error("start/end range require options.decodeFileData === false for non-trivial encoded entries.");
      }
      if (!self.isOpen) return callback(new Error("closed"));
      if (entry.isEncrypted() && !rawMode) {
        if (options2.decrypt !== false) return callback(new Error("entry is encrypted, and options.decodeFileData !== false"));
      }
      var decompress;
      if (rawMode) {
        decompress = false;
      } else if (entry.compressionMethod === 8) {
        decompress = options2.decodeFileData !== true;
      } else {
        return callback(new Error("unsupported compression method: " + entry.compressionMethod));
      }
      self.readLocalFileHeader(entry, { minimal: true }, function(err, localFileHeader) {
        if (err) return callback(err);
        self.openReadStreamLowLevel(
          localFileHeader.fileDataStart,
          entry.compressedSize,
          relativeStart,
          relativeEnd,
          decompress,
          entry.uncompressedSize,
          callback
        );
      });
    };
    ZipFile.prototype.openReadStreamLowLevel = function(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize, callback) {
      var self = this;
      var fileDataEnd = fileDataStart + compressedSize;
      var readStream = self.reader.createReadStream({
        start: fileDataStart + relativeStart,
        end: fileDataStart + relativeEnd
      });
      var endpointStream = readStream;
      if (decompress) {
        var destroyed = false;
        var inflateFilter = zlib.createInflateRaw();
        readStream.on("error", function(err) {
          setImmediate(function() {
            if (!destroyed) inflateFilter.emit("error", err);
          });
        });
        readStream.pipe(inflateFilter);
        if (self.validateEntrySizes) {
          endpointStream = new AssertByteCountStream(uncompressedSize);
          inflateFilter.on("error", function(err) {
            setImmediate(function() {
              if (!destroyed) endpointStream.emit("error", err);
            });
          });
          inflateFilter.pipe(endpointStream);
        } else {
          endpointStream = inflateFilter;
        }
        installDestroyFn(endpointStream, function() {
          destroyed = true;
          if (inflateFilter !== endpointStream) inflateFilter.unpipe(endpointStream);
          readStream.unpipe(inflateFilter);
          readStream.destroy();
        });
      }
      callback(null, endpointStream);
    };
    ZipFile.prototype.readLocalFileHeader = function(entry, options2, callback) {
      var self = this;
      if (callback == null) {
        callback = options2;
        options2 = null;
      }
      if (options2 == null) options2 = {};
      self.reader.ref();
      var buffer = newBuffer(30);
      readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader, function(err) {
        try {
          if (err) return callback(err);
          var signature = buffer.readUInt32LE(0);
          if (signature !== 67324752) {
            return callback(new Error("invalid local file header signature: 0x" + signature.toString(16)));
          }
          var fileNameLength = buffer.readUInt16LE(26);
          var extraFieldLength = buffer.readUInt16LE(28);
          var fileDataStart = entry.relativeOffsetOfLocalHeader + 30 + fileNameLength + extraFieldLength;
          if (fileDataStart + entry.compressedSize > self.fileSize) {
            return callback(new Error("file data overflows file bounds: " + fileDataStart + " + " + entry.compressedSize + " > " + self.fileSize));
          }
          if (options2.minimal) {
            return callback(null, { fileDataStart });
          }
          var localFileHeader = new LocalFileHeader();
          localFileHeader.fileDataStart = fileDataStart;
          localFileHeader.versionNeededToExtract = buffer.readUInt16LE(4);
          localFileHeader.generalPurposeBitFlag = buffer.readUInt16LE(6);
          localFileHeader.compressionMethod = buffer.readUInt16LE(8);
          localFileHeader.lastModFileTime = buffer.readUInt16LE(10);
          localFileHeader.lastModFileDate = buffer.readUInt16LE(12);
          localFileHeader.crc32 = buffer.readUInt32LE(14);
          localFileHeader.compressedSize = buffer.readUInt32LE(18);
          localFileHeader.uncompressedSize = buffer.readUInt32LE(22);
          localFileHeader.fileNameLength = fileNameLength;
          localFileHeader.extraFieldLength = extraFieldLength;
          buffer = newBuffer(fileNameLength + extraFieldLength);
          self.reader.ref();
          readAndAssertNoEof(self.reader, buffer, 0, buffer.length, entry.relativeOffsetOfLocalHeader + 30, function(err2) {
            try {
              if (err2) return callback(err2);
              localFileHeader.fileName = buffer.subarray(0, fileNameLength);
              localFileHeader.extraField = buffer.subarray(fileNameLength);
              return callback(null, localFileHeader);
            } finally {
              self.reader.unref();
            }
          });
        } finally {
          self.reader.unref();
        }
      });
    };
    ZipFile.prototype.openReadStreamPromise = function(entry, options2) {
      return new Promise((resolve, reject) => {
        this.openReadStream(entry, options2, function(err, readStream) {
          if (err) return reject(err);
          resolve(readStream);
        });
      });
    };
    ZipFile.prototype.openReadStreamLowLevelPromise = function(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize) {
      return new Promise((resolve, reject) => {
        this.openReadStream(fileDataStart, compressedSize, relativeStart, relativeEnd, decompress, uncompressedSize, function(err, readStream) {
          if (err) return reject(err);
          resolve(readStream);
        });
      });
    };
    ZipFile.prototype.readLocalFileHeaderPromise = function(entry, options2) {
      return new Promise((resolve, reject) => {
        this.readLocalFileHeader(entry, options2, function(err, localFileHeader) {
          if (err) return reject(err);
          resolve(localFileHeader);
        });
      });
    };
    function Entry() {
    }
    Entry.prototype.getLastModDate = function(options2) {
      if (options2 == null) options2 = {};
      if (!options2.forceDosFormat) {
        for (var i = 0; i < this.extraFields.length; i++) {
          var extraField = this.extraFields[i];
          if (extraField.id === 21589) {
            var data = extraField.data;
            if (data.length < 5) continue;
            var flags = data[0];
            var HAS_MTIME = 1;
            if (!(flags & HAS_MTIME)) continue;
            var posixTimestamp = data.readInt32LE(1);
            return new Date(posixTimestamp * 1e3);
          } else if (extraField.id === 10) {
            var data = extraField.data;
            if (data.length !== 32) continue;
            if (data.readUInt16LE(4) !== 1) continue;
            if (data.readUInt16LE(6) !== 24) continue;
            var hundredNanoSecondsSince1601 = data.readUInt32LE(8) + 4294967296 * data.readInt32LE(12);
            var millisecondsSince1970 = hundredNanoSecondsSince1601 / 1e4 - 116444736e5;
            return new Date(millisecondsSince1970);
          }
        }
      }
      return dosDateTimeToDate(this.lastModFileDate, this.lastModFileTime, options2.timezone);
    };
    Entry.prototype.canDecodeFileData = function() {
      return !this.isEncrypted() && (this.compressionMethod === 0 || this.compressionMethod === 8);
    };
    Entry.prototype.isEncrypted = function() {
      return (this.generalPurposeBitFlag & 1) !== 0;
    };
    Entry.prototype.isCompressed = function() {
      return this.compressionMethod === 8;
    };
    function LocalFileHeader() {
    }
    function dosDateTimeToDate(date, time, timezone) {
      var day = date & 31;
      var month = (date >> 5 & 15) - 1;
      var year = (date >> 9 & 127) + 1980;
      var millisecond = 0;
      var second = (time & 31) * 2;
      var minute = time >> 5 & 63;
      var hour = time >> 11 & 31;
      if (timezone == null || timezone === "local") {
        return new Date(year, month, day, hour, minute, second, millisecond);
      } else if (timezone === "UTC") {
        return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
      } else {
        throw new Error("unrecognized options.timezone: " + options.timezone);
      }
    }
    function getFileNameLowLevel(generalPurposeBitFlag, fileNameBuffer, extraFields, strictFileNames) {
      var fileName = null;
      for (var i = 0; i < extraFields.length; i++) {
        var extraField = extraFields[i];
        if (extraField.id === 28789) {
          if (extraField.data.length < 6) {
            continue;
          }
          if (extraField.data.readUInt8(0) !== 1) {
            continue;
          }
          var oldNameCrc32 = extraField.data.readUInt32LE(1);
          if (crc32(fileNameBuffer) !== oldNameCrc32) {
            continue;
          }
          fileName = decodeBuffer(extraField.data.subarray(5), true);
          break;
        }
      }
      if (fileName == null) {
        var isUtf8 = (generalPurposeBitFlag & 2048) !== 0;
        fileName = decodeBuffer(fileNameBuffer, isUtf8);
      }
      if (!strictFileNames) {
        fileName = fileName.replace(/\\/g, "/");
      }
      return fileName;
    }
    function validateFileName(fileName) {
      if (fileName.indexOf("\\") !== -1) {
        return "invalid characters in fileName: " + fileName;
      }
      if (/^[a-zA-Z]:/.test(fileName) || /^\//.test(fileName)) {
        return "absolute path: " + fileName;
      }
      if (fileName.split("/").indexOf("..") !== -1) {
        return "invalid relative path: " + fileName;
      }
      return null;
    }
    function parseExtraFields(extraFieldBuffer) {
      var extraFields = [];
      var i = 0;
      while (i < extraFieldBuffer.length - 3) {
        var headerId = extraFieldBuffer.readUInt16LE(i + 0);
        var dataSize = extraFieldBuffer.readUInt16LE(i + 2);
        var dataStart = i + 4;
        var dataEnd = dataStart + dataSize;
        if (dataEnd > extraFieldBuffer.length) throw new Error("extra field length exceeds extra field buffer size");
        var dataBuffer = extraFieldBuffer.subarray(dataStart, dataEnd);
        extraFields.push({
          id: headerId,
          data: dataBuffer
        });
        i = dataEnd;
      }
      return extraFields;
    }
    function readAndAssertNoEof(reader, buffer, offset, length, position, callback) {
      if (length === 0) {
        return setImmediate(function() {
          callback(null, newBuffer(0));
        });
      }
      reader.read(buffer, offset, length, position, function(err, bytesRead) {
        if (err) return callback(err);
        if (bytesRead < length) {
          return callback(new Error("unexpected EOF"));
        }
        callback();
      });
    }
    util.inherits(AssertByteCountStream, Transform);
    function AssertByteCountStream(byteCount) {
      Transform.call(this);
      this.actualByteCount = 0;
      this.expectedByteCount = byteCount;
    }
    AssertByteCountStream.prototype._transform = function(chunk, encoding, cb) {
      this.actualByteCount += chunk.length;
      if (this.actualByteCount > this.expectedByteCount) {
        var msg = "too many bytes in the stream. expected " + this.expectedByteCount + ". got at least " + this.actualByteCount;
        return cb(new Error(msg));
      }
      cb(null, chunk);
    };
    AssertByteCountStream.prototype._flush = function(cb) {
      if (this.actualByteCount < this.expectedByteCount) {
        var msg = "not enough bytes in the stream. expected " + this.expectedByteCount + ". got only " + this.actualByteCount;
        return cb(new Error(msg));
      }
      cb();
    };
    util.inherits(RandomAccessReader, EventEmitter);
    function RandomAccessReader() {
      EventEmitter.call(this);
      this.refCount = 0;
    }
    RandomAccessReader.prototype.ref = function() {
      this.refCount += 1;
    };
    RandomAccessReader.prototype.unref = function() {
      var self = this;
      self.refCount -= 1;
      if (self.refCount > 0) return;
      if (self.refCount < 0) throw new Error("invalid unref");
      self.close(onCloseDone);
      function onCloseDone(err) {
        if (err) return self.emit("error", err);
        self.emit("close");
      }
    };
    RandomAccessReader.prototype.createReadStream = function(options2) {
      if (options2 == null) options2 = {};
      var start = options2.start;
      var end = options2.end;
      if (start === end) {
        var emptyStream = new PassThrough();
        setImmediate(function() {
          emptyStream.end();
        });
        return emptyStream;
      }
      var stream = this._readStreamForRange(start, end);
      var destroyed = false;
      var refUnrefFilter = new RefUnrefFilter(this);
      stream.on("error", function(err) {
        setImmediate(function() {
          if (!destroyed) refUnrefFilter.emit("error", err);
        });
      });
      installDestroyFn(refUnrefFilter, function() {
        stream.unpipe(refUnrefFilter);
        refUnrefFilter.unref();
        stream.destroy();
      });
      var byteCounter = new AssertByteCountStream(end - start);
      refUnrefFilter.on("error", function(err) {
        setImmediate(function() {
          if (!destroyed) byteCounter.emit("error", err);
        });
      });
      installDestroyFn(byteCounter, function() {
        destroyed = true;
        refUnrefFilter.unpipe(byteCounter);
        refUnrefFilter.destroy();
      });
      return stream.pipe(refUnrefFilter).pipe(byteCounter);
    };
    RandomAccessReader.prototype._readStreamForRange = function(start, end) {
      throw new Error("not implemented");
    };
    RandomAccessReader.prototype.read = function(buffer, offset, length, position, callback) {
      var readStream = this.createReadStream({ start: position, end: position + length });
      var writeStream = new Writable();
      var written = 0;
      writeStream._write = function(chunk, encoding, cb) {
        chunk.copy(buffer, offset + written, 0, chunk.length);
        written += chunk.length;
        cb();
      };
      writeStream.on("finish", callback);
      readStream.on("error", function(error) {
        callback(error);
      });
      readStream.pipe(writeStream);
    };
    RandomAccessReader.prototype.close = function(callback) {
      setImmediate(callback);
    };
    util.inherits(RefUnrefFilter, PassThrough);
    function RefUnrefFilter(context) {
      PassThrough.call(this);
      this.context = context;
      this.context.ref();
      this.unreffedYet = false;
    }
    RefUnrefFilter.prototype._flush = function(cb) {
      this.unref();
      cb();
    };
    RefUnrefFilter.prototype.unref = function(cb) {
      if (this.unreffedYet) return;
      this.unreffedYet = true;
      this.context.unref();
    };
    var cp437 = "\0\u263A\u263B\u2665\u2666\u2663\u2660\u2022\u25D8\u25CB\u25D9\u2642\u2640\u266A\u266B\u263C\u25BA\u25C4\u2195\u203C\xB6\xA7\u25AC\u21A8\u2191\u2193\u2192\u2190\u221F\u2194\u25B2\u25BC !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u2302\xC7\xFC\xE9\xE2\xE4\xE0\xE5\xE7\xEA\xEB\xE8\xEF\xEE\xEC\xC4\xC5\xC9\xE6\xC6\xF4\xF6\xF2\xFB\xF9\xFF\xD6\xDC\xA2\xA3\xA5\u20A7\u0192\xE1\xED\xF3\xFA\xF1\xD1\xAA\xBA\xBF\u2310\xAC\xBD\xBC\xA1\xAB\xBB\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580\u03B1\xDF\u0393\u03C0\u03A3\u03C3\xB5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229\u2261\xB1\u2265\u2264\u2320\u2321\xF7\u2248\xB0\u2219\xB7\u221A\u207F\xB2\u25A0\xA0";
    function decodeBuffer(buffer, isUtf8) {
      if (isUtf8) {
        return buffer.toString("utf8");
      } else {
        var result = "";
        for (var i = 0; i < buffer.length; i++) {
          result += cp437[buffer[i]];
        }
        return result;
      }
    }
    function readUInt64LE(buffer, offset) {
      var lower32 = buffer.readUInt32LE(offset);
      var upper32 = buffer.readUInt32LE(offset + 4);
      return upper32 * 4294967296 + lower32;
    }
    var newBuffer;
    if (typeof Buffer.allocUnsafe === "function") {
      newBuffer = function(len) {
        return Buffer.allocUnsafe(len);
      };
    } else {
      newBuffer = function(len) {
        return new Buffer(len);
      };
    }
    function installDestroyFn(stream, fn) {
      if (typeof stream.destroy === "function") {
        stream._destroy = function(err, cb) {
          fn();
          if (cb != null) cb(err);
        };
      } else {
        stream.destroy = fn;
      }
    }
    function defaultCallback(err) {
      if (err) throw err;
    }
  }
});

// .internal-tools/trusted-preview.mjs
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// .internal-tools/static-archive.mjs
var import_yauzl = __toESM(require_yauzl(), 1);
import { createHash } from "node:crypto";
var DEFAULT_LIMITS = Object.freeze({
  compressedBytes: 128 * 1024 * 1024,
  unpackedBytes: 512 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  entries: 1e5
});
function safeArchivePath(value, directory = false) {
  if (typeof value !== "string" || /[\x00-\x1f\x7f\\:]/.test(value) || value.startsWith("/")) {
    throw new Error("Archive contains an unsafe path");
  }
  const normalized = directory && value.endsWith("/") ? value.slice(0, -1) : value;
  if (!normalized || normalized !== normalized.normalize("NFC")) throw new Error("Archive path is not canonical");
  for (const part of normalized.split("/")) {
    if (!part || part === "." || part === ".." || /^\.git/i.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new Error("Archive contains a traversal, Git-control, or reserved path");
    }
  }
  return normalized;
}
function boundedSize(value, limit, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error("Archive exceeds " + label);
}
function openZip(buffer) {
  return new Promise(
    (resolve, reject) => import_yauzl.default.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        autoClose: false,
        validateEntrySizes: true,
        strictFileNames: true
      },
      (error, zip) => error ? reject(error) : resolve(zip)
    )
  );
}
function inspectEntries(zip, limits, allowedPaths, allowedPattern) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const paths = /* @__PURE__ */ new Map();
    let declaredBytes = 0;
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("entry", (entry) => {
      try {
        if (entries.length >= limits.entries) throw new Error("Archive exceeds entry count");
        if (entry.generalPurposeBitFlag & 1) throw new Error("Encrypted archives are forbidden");
        if (![0, 8].includes(entry.compressionMethod)) throw new Error("Unsupported archive compression");
        const directory = entry.fileName.endsWith("/");
        const name = safeArchivePath(entry.fileName, directory);
        const mode = entry.externalFileAttributes >>> 16;
        const kind = mode & 61440;
        if (kind && kind !== (directory ? 16384 : 32768))
          throw new Error("Archive symlinks and special files are forbidden");
        if (!directory && mode & 73) throw new Error("Executable archive files are forbidden");
        boundedSize(entry.uncompressedSize, directory ? 0 : limits.fileBytes, "file size");
        boundedSize(entry.compressedSize, limits.compressedBytes, "compressed entry size");
        declaredBytes += entry.uncompressedSize;
        boundedSize(declaredBytes, limits.unpackedBytes, "unpacked size");
        const key = name.toLowerCase();
        if (paths.has(key)) throw new Error("Duplicate or case-conflicting archive path");
        if (!directory && allowedPaths && !allowedPaths.has(name)) throw new Error("Unexpected archive file");
        if (!directory && allowedPattern && !allowedPattern.test(name))
          throw new Error("Unexpected archive file pattern");
        paths.set(key, { name, directory });
        entries.push({ entry, name, directory });
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.on("end", () => {
      if (finished) return;
      try {
        for (const { name } of entries) {
          const parts = name.split("/");
          for (let length = 1; length < parts.length; length++) {
            const parent = paths.get(parts.slice(0, length).join("/").toLowerCase());
            if (parent && !parent.directory) throw new Error("Archive file conflicts with a parent directory");
          }
        }
        finished = true;
        resolve(entries.filter((entry) => !entry.directory));
      } catch (error) {
        fail(error);
      }
    });
    zip.readEntry();
  });
}
function readEntry(zip, entry, limit) {
  return new Promise(
    (resolve, reject) => zip.openReadStream(entry, (error, stream) => {
      if (error) return reject(error);
      const chunks = [];
      let bytes = 0;
      stream.on("error", reject);
      stream.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > limit || bytes > entry.uncompressedSize) {
          stream.destroy(new Error("Archive data exceeds declared size or file limit"));
        } else {
          chunks.push(chunk);
        }
      });
      stream.on("end", () => {
        if (bytes !== entry.uncompressedSize) return reject(new Error("Archive data size mismatch"));
        resolve(Buffer.concat(chunks));
      });
    })
  );
}
async function readStaticArchive(buffer, options2 = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options2.limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid archive limit");
  }
  boundedSize(buffer.length, limits.compressedBytes, "compressed size");
  const allowedPaths = options2.allowedPaths ? new Set(options2.allowedPaths) : null;
  if (allowedPaths) for (const name of allowedPaths) safeArchivePath(name);
  const zip = await openZip(buffer);
  try {
    const entries = await inspectEntries(zip, limits, allowedPaths, options2.allowedPattern);
    if (!entries.length) throw new Error("Archive contains no static files");
    const files = /* @__PURE__ */ new Map();
    let actualBytes = 0;
    for (const { entry, name } of entries) {
      const content = await readEntry(zip, entry, limits.fileBytes);
      actualBytes += content.length;
      boundedSize(actualBytes, limits.unpackedBytes, "unpacked size");
      if (options2.jsonOnly || options2.jsonPathPrefix && name.startsWith(options2.jsonPathPrefix)) {
        try {
          JSON.parse(content.toString("utf8"));
        } catch {
          throw new Error("Artifact contains invalid JSON data");
        }
      }
      const oid = createHash("sha1").update("blob " + content.length + "\0").update(content).digest("hex");
      files.set(name, { oid, contents: content.toString("base64") });
    }
    if (allowedPaths && [...allowedPaths].some((name) => !files.has(name)))
      throw new Error("Archive is missing a required file");
    return files;
  } finally {
    zip.close();
  }
}

// .internal-tools/preview-content.mjs
import { createHash as createHash2 } from "node:crypto";
var SEARCH_STYLE = '<style id="pr-preview-search-disabled">.navbar__search,.navbar-sidebar__search{display:none!important}</style>';
function hideDocumentationSearch(html) {
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const rawText = /* @__PURE__ */ new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes"]);
  let isDocusaurus = false;
  let hasSearchStyle = false;
  for (let token = tags.exec(html); token; token = tags.exec(html)) {
    const tag = /^<(\/?)([a-z][a-z0-9:-]*)\b/i.exec(token[0]);
    if (!tag) continue;
    const closing = Boolean(tag[1]);
    const name = tag[2].toLowerCase();
    if (closing && name === "head") {
      return isDocusaurus && !hasSearchStyle ? html.slice(0, token.index) + SEARCH_STYLE + html.slice(token.index) : html;
    }
    if (closing) continue;
    const attributes = /* @__PURE__ */ new Map();
    const attributePattern = /\s([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
    for (const attribute of token[0].slice(tag[0].length).matchAll(attributePattern)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    if (name === "meta" && attributes.get("name")?.toLowerCase() === "generator") {
      isDocusaurus ||= attributes.get("content")?.toLowerCase().startsWith("docusaurus") ?? false;
    }
    if (name === "style" && attributes.get("id") === "pr-preview-search-disabled") hasSearchStyle = true;
    if (rawText.has(name)) {
      const end = new RegExp("</" + name + "\\s*[^>]*>", "gi");
      end.lastIndex = tags.lastIndex;
      if (!end.exec(html)) return html;
      tags.lastIndex = end.lastIndex;
    }
  }
  return html;
}
function isSearchIndex(name) {
  return /^search-index.*\.json(?:\.(?:gz|br))?$/.test(name);
}
function prepareStaticPreview(files, includeSearchIndexes = false) {
  const desired = new Map(files);
  let removed = 0;
  if (!includeSearchIndexes) {
    for (const name of desired.keys()) {
      if (isSearchIndex(name.split("/").at(-1))) {
        desired.delete(name);
        removed++;
      }
    }
  }
  if (!removed) return desired;
  for (const [name, entry] of desired) {
    if (!name.endsWith(".html")) continue;
    const content = Buffer.from(entry.contents, "base64");
    let html;
    try {
      html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      continue;
    }
    const updated = hideDocumentationSearch(html);
    if (updated === html) continue;
    const buffer = Buffer.from(updated);
    const oid = createHash2("sha1").update("blob " + buffer.length + String.fromCharCode(0)).update(buffer).digest("hex");
    desired.set(name, { ...entry, oid, contents: buffer.toString("base64") });
  }
  return desired;
}

// .internal-tools/publish-static-preview.mjs
var COMMIT_MUTATION = `
  mutation PublishPreview($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit {
        oid
        signature {
          isValid
          wasSignedByGitHub
          state
        }
      }
    }
  }
`;
var OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
function validatePath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe preview file path: ${JSON.stringify(value)}.`);
  }
  return value;
}
function validateOid(value, label) {
  if (typeof value !== "string" || !OID.test(value)) throw new Error(`Invalid ${label} from GitHub.`);
  return value;
}
var GitHubApiError = class extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.errors = errors;
  }
};
function createApiClient(config, fetchImpl = globalThis.fetch) {
  async function request(url, method, body) {
    const response = await fetchImpl(url, {
      method,
      redirect: "manual",
      headers: {
        "authorization": `Bearer ${config.token}`,
        "accept": "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "ord-trusted-static-preview"
      },
      signal: AbortSignal.timeout(6e4),
      ...body === void 0 ? {} : { body: JSON.stringify(body) }
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new GitHubApiError(`GitHub ${method} returned a non-JSON response (HTTP ${response.status}).`, {
        status: response.status
      });
    }
    if (!response.ok) {
      throw new GitHubApiError(`GitHub ${method} failed (HTTP ${response.status})`, {
        status: response.status
      });
    }
    return data;
  }
  const repository = config.repository.split("/").map(encodeURIComponent).join("/");
  return {
    get: (resource) => request(`${config.apiUrl}/repos/${repository}/${resource}`, "GET"),
    async commit(input) {
      const result = await request(config.graphqlUrl, "POST", { query: COMMIT_MUTATION, variables: { input } });
      if (result.errors?.length) {
        throw new GitHubApiError(
          `GitHub commit mutation failed: ${result.errors.map((error) => error.message).join("; ")}`,
          { errors: result.errors }
        );
      }
      const commit = result.data?.createCommitOnBranch?.commit;
      if (!commit) throw new GitHubApiError("GitHub did not return the new preview commit.");
      validateOid(commit.oid, "preview commit OID");
      if (commit.signature?.isValid !== true || commit.signature?.wasSignedByGitHub !== true || commit.signature?.state !== "VALID") {
        throw new GitHubApiError(
          `Preview commit ${commit.oid} did not receive a verified GitHub signature; check Enterprise web commit signing.`
        );
      }
      return commit;
    }
  };
}
function requireTree(response, label) {
  if (response?.truncated) throw new Error(`${label} is truncated; refusing to publish an incomplete preview diff.`);
  if (!Array.isArray(response?.tree)) throw new Error(`${label} did not contain a file tree.`);
  for (const entry of response.tree) validatePath(entry?.path);
  return response.tree;
}
async function readPreviewState(client, config) {
  const branch = config.branch.split("/").map(encodeURIComponent).join("/");
  const ref = await client.get(`git/ref/heads/${branch}`);
  const head = validateOid(ref?.object?.sha, "branch head");
  const commit = await client.get(`git/commits/${head}`);
  const treeOid = validateOid(commit?.tree?.sha, "root tree OID");
  const root = requireTree(await client.get(`git/trees/${treeOid}`), "Pages root tree");
  let parent = root;
  if (config.pathPrefix) {
    validatePath(config.pathPrefix);
    for (const component of config.pathPrefix.split("/")) {
      const entry = parent.find((item) => item.path === component);
      if (!entry) {
        parent = [];
        break;
      }
      if (entry.type !== "tree") throw new Error("Preview prefix is not a directory");
      parent = requireTree(
        await client.get("git/trees/" + validateOid(entry.sha, "prefix tree OID")),
        "Preview prefix tree"
      );
    }
  }
  const folder = parent.find((entry) => entry.path === "pr-" + config.pr);
  const marker = root.find((entry) => entry.path === ".nojekyll");
  if (marker && (marker.type !== "blob" || marker.mode !== "100644")) {
    throw new Error("The Pages .nojekyll marker is not a regular file.");
  }
  const files = /* @__PURE__ */ new Map();
  if (folder) {
    if (folder.type !== "tree") throw new Error(`pr-${config.pr} is not a preview directory.`);
    const entries = requireTree(
      await client.get(`git/trees/${validateOid(folder.sha, "preview tree OID")}?recursive=1`),
      "Existing preview tree"
    );
    for (const entry of entries) {
      if (entry.type === "tree") continue;
      if (files.has(entry.path)) throw new Error(`Duplicate existing preview path: ${entry.path}.`);
      files.set(entry.path, { oid: validateOid(entry.sha, "preview file OID"), mode: entry.mode });
    }
  }
  return { head, files, exists: Boolean(folder), hasNojekyll: Boolean(marker) };
}
function buildFileChanges({ pr, action, files, state, pathPrefix = "" }) {
  if (!/^[1-9]\d*$/.test(pr)) throw new Error("PR must be a positive pull request number.");
  if (pathPrefix) validatePath(pathPrefix);
  const prefix = (pathPrefix ? pathPrefix + "/" : "") + "pr-" + pr + "/";
  const additions = [];
  const deletions = [];
  const desired = action === "closed" ? /* @__PURE__ */ new Map() : files;
  for (const [file, entry] of desired) {
    validatePath(file);
    const previous = state.files.get(file);
    if (previous && previous.mode !== "100644") throw new Error(`Unsupported existing preview file mode: ${file}.`);
    if (previous?.oid !== entry.oid) additions.push({ path: prefix + file, contents: entry.contents });
  }
  for (const file of state.files.keys()) {
    validatePath(file);
    const nestedPreview = file.split("/").slice(0, -1).some((part) => part.startsWith("pr-"));
    if (!desired.has(file) && (action === "closed" || !nestedPreview)) deletions.push({ path: prefix + file });
  }
  if (!state.hasNojekyll) additions.push({ path: ".nojekyll", contents: "" });
  additions.sort((a, b) => a.path.localeCompare(b.path));
  deletions.sort((a, b) => a.path.localeCompare(b.path));
  return { additions, deletions };
}
function isStaleHead(error) {
  return error instanceof GitHubApiError && error.errors?.length > 0 && error.errors.every(
    (entry) => [entry.type, entry.extensions?.code, entry.extensions?.type].some((value) => value === "STALE_DATA")
  );
}
async function publishFiles(config, files, {
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
  beforeCommit = async () => true
} = {}) {
  const client = createApiClient(config, fetchImpl);
  let removed = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const state = await readPreviewState(client, config);
    removed ||= config.action === "closed" && state.exists;
    if (config.action === "closed" && !state.exists) return { removed, changed: false, oid: state.head };
    if (!await beforeCommit()) return { skipped: true, removed: false, changed: false, oid: state.head };
    const fileChanges = buildFileChanges({
      pr: config.pr,
      action: config.action,
      files,
      state,
      pathPrefix: config.pathPrefix
    });
    if (fileChanges.additions.length === 0 && fileChanges.deletions.length === 0) {
      log("No changes to publish.");
      return { removed, changed: false, oid: state.head };
    }
    try {
      const commit = await client.commit({
        branch: { repositoryNameWithOwner: config.repository, branchName: config.branch },
        expectedHeadOid: state.head,
        message: {
          headline: config.action === "closed" ? `preview: remove pr-${config.pr} (PR closed)` : `preview: pr-${config.pr} @ ${config.sha.slice(0, 7)}`
        },
        fileChanges
      });
      log(`Published verified GitHub-signed preview commit ${commit.oid}.`);
      return { removed, changed: true, oid: commit.oid };
    } catch (error) {
      if (!isStaleHead(error)) throw error;
      if (attempt === 5) throw new Error("Pages branch kept changing; failed to publish the preview after 5 attempts.");
      log(`Pages branch changed; rebuilding the preview diff (attempt ${attempt + 1}).`);
      await sleep(1e3);
    }
  }
}

// .internal-tools/trusted-preview.mjs
var REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
var OID2 = /^[a-f0-9]{40}$/;
var WORKFLOW = /^[A-Za-z0-9_.-]+\.ya?ml$/;
function requireString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing " + label);
  return value;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid " + label);
  return number;
}
function httpsUrl(value, label) {
  const url = new URL(requireString(value, label));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid " + label);
  return url;
}
function loadWorkerConfig(env = process.env) {
  const api = httpsUrl(env.GITHUB_API_URL, "GitHub API URL");
  const graphql = httpsUrl(env.GITHUB_GRAPHQL_URL, "GitHub GraphQL URL");
  if (api.origin !== graphql.origin) throw new Error("GitHub API origins differ");
  const mode = requireString(env.WORKER_MODE, "worker mode");
  if (!["workflow-run", "download-verified"].includes(mode)) throw new Error("Unsupported trusted worker mode");
  const repository = requireString(env.GITHUB_REPOSITORY, "source repository");
  const producer = requireString(env.PRODUCER_WORKFLOW, "producer workflow");
  if (!REPOSITORY.test(repository) || !WORKFLOW.test(producer))
    throw new Error("Invalid repository or producer workflow");
  const config = {
    mode,
    repository,
    sourceToken: requireString(env.SOURCE_TOKEN, "source token"),
    token: env.PUBLICATION_TOKEN || env.SOURCE_TOKEN,
    apiUrl: api.href.replace(/\/+$/, ""),
    graphqlUrl: graphql.href,
    eventName: env.GITHUB_EVENT_NAME,
    eventPath: requireString(env.GITHUB_EVENT_PATH, "event path"),
    runId: positiveInteger(env.PRODUCER_RUN_ID, "producer run ID"),
    currentRunId: positiveInteger(env.GITHUB_RUN_ID, "current run ID"),
    producer,
    expectedBranch: env.EXPECTED_BASE_BRANCH || "main",
    artifactName: requireString(env.STATIC_ARTIFACT_NAME, "artifact name"),
    targetRepository: env.TARGET_REPOSITORY || repository,
    branch: env.TARGET_BRANCH || "main",
    pathPrefix: env.PREVIEW_PATH_PREFIX || "",
    pagesBaseUrl: env.PAGES_BASE_URL || "",
    commentHeader: env.COMMENT_HEADER || "pr-preview",
    commentTitle: env.COMMENT_TITLE || "PR Preview",
    commentFooter: env.COMMENT_FOOTER || "",
    qr: env.QR_CODE !== "false",
    includeSearchIndexes: env.INCLUDE_SEARCH_INDEXES === "true",
    outputFile: env.GITHUB_OUTPUT,
    tempRoot: env.RUNNER_TEMP || os.tmpdir(),
    jsonOnly: mode === "download-verified" && env.ARTIFACT_FORMAT !== "static",
    jsonPathPrefix: env.JSON_PATH_PREFIX || "",
    allowedPattern: null,
    allowedPaths: env.EXPECTED_ARTIFACT_FILES ? JSON.parse(env.EXPECTED_ARTIFACT_FILES) : null,
    limits: { ...DEFAULT_LIMITS }
  };
  if (!REPOSITORY.test(config.targetRepository) || !/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/.test(config.branch) || config.branch.split("/").some((p) => !p || p.startsWith(".") || p.endsWith(".") || p.endsWith(".lock")) || config.branch.includes("..")) {
    throw new Error("Invalid trusted publication target");
  }
  if (config.pathPrefix) safeArchivePath(config.pathPrefix, true);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(config.commentHeader)) throw new Error("Invalid comment marker");
  if (config.pagesBaseUrl) httpsUrl(config.pagesBaseUrl, "Pages URL");
  if (config.allowedPaths !== null && (!Array.isArray(config.allowedPaths) || !config.allowedPaths.length || config.allowedPaths.some((p) => typeof p !== "string"))) {
    throw new Error("Expected artifact paths must be a nonempty array");
  }
  if (env.ARTIFACT_FORMAT && !["json", "static"].includes(env.ARTIFACT_FORMAT))
    throw new Error("Unsupported artifact format");
  if (config.jsonPathPrefix) safeArchivePath(config.jsonPathPrefix, true);
  if (env.EXPECTED_ARTIFACT_PATTERN) {
    const pattern = env.EXPECTED_ARTIFACT_PATTERN;
    if (pattern.length > 1024 || !pattern.startsWith("^") || !pattern.endsWith("$"))
      throw new Error("Artifact pattern must be a bounded anchored trusted expression");
    config.allowedPattern = new RegExp(pattern);
  }
  if (config.mode === "download-verified" && !config.allowedPaths && !config.allowedPattern)
    throw new Error("Data downloads require an exact or pattern file allowlist");
  return config;
}
function createSourceClient(config, fetchImpl = globalThis.fetch) {
  async function request(resource, method = "GET", body) {
    const response = await fetchImpl(config.apiUrl + "/repos/" + config.repository + (resource ? "/" + resource : ""), {
      method,
      redirect: "manual",
      headers: {
        "authorization": "Bearer " + config.sourceToken,
        "accept": "application/vnd.github+json",
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(6e4),
      ...body === void 0 ? {} : { body: JSON.stringify(body) }
    });
    if (!response.ok) throw new Error("GitHub metadata request failed (HTTP " + response.status + ")");
    return response.json();
  }
  async function list(resource, field) {
    const values = [];
    for (let page = 1; page <= 1e3; page++) {
      const response = await request(resource + (resource.includes("?") ? "&" : "?") + "per_page=100&page=" + page);
      const entries = field ? response[field] : response;
      if (!Array.isArray(entries)) throw new Error("Invalid GitHub paginated response");
      values.push(...entries);
      if (entries.length < 100) return values;
    }
    throw new Error("GitHub metadata pagination exceeds limits");
  }
  return { get: request, request, list };
}
async function verifyProducer(config, event, client) {
  if (config.mode === "workflow-run") {
    if (config.eventName !== "workflow_run" || event.workflow_run?.id !== config.runId)
      throw new Error("Worker is not associated with its workflow_run event");
  } else if (!["schedule", "workflow_dispatch"].includes(config.eventName) || config.currentRunId !== config.runId) {
    throw new Error("Data worker must consume its own trusted scheduled or manual run");
  }
  const repo = await client.get("");
  const workflow = await client.get("actions/workflows/" + encodeURIComponent(config.producer));
  const run = await client.get("actions/runs/" + config.runId);
  if (!Number.isSafeInteger(repo.id) || repo.full_name?.toLowerCase() !== config.repository.toLowerCase() || workflow.path !== ".github/workflows/" + config.producer || run.workflow_id !== workflow.id || run.repository?.id !== repo.id || run.head_repository?.id !== repo.id || !OID2.test(run.head_sha || "")) {
    throw new Error("Producer workflow or repository association is invalid");
  }
  if (config.mode === "download-verified") {
    const ref = await client.get("git/ref/heads/" + encodeURIComponent(config.expectedBranch));
    if (repo.default_branch !== config.expectedBranch || run.head_branch !== config.expectedBranch || !["schedule", "workflow_dispatch"].includes(run.event) || ref.object?.sha !== run.head_sha) {
      throw new Error("Data producer is not the current protected default-branch revision");
    }
    return { repo, run, sha: run.head_sha };
  }
  if (run.event !== "pull_request" || run.status !== "completed")
    throw new Error("Unexpected preview producer event or status");
  let associations = run.pull_requests;
  if (!Array.isArray(associations) || !associations.length)
    associations = await client.list("commits/" + run.head_sha + "/pulls");
  if (associations.length !== 1 || !Number.isSafeInteger(associations[0].number) || associations[0].number <= 0)
    throw new Error("Ambiguous producer PR association");
  const association = associations[0];
  const pr = await client.get("pulls/" + association.number);
  if (pr.number !== association.number || pr.base?.repo?.id !== repo.id || pr.base.ref !== config.expectedBranch || pr.head?.repo?.id !== repo.id) {
    throw new Error("Preview PR origin or base branch is not permitted");
  }
  const expectedHead = association.head?.sha || run.head_sha;
  if (!OID2.test(expectedHead)) throw new Error("Invalid producer head");
  if (pr.state === "closed") return { repo, run, pr, sha: expectedHead, action: "closed" };
  if (pr.state !== "open" || pr.draft || pr.head.sha !== expectedHead) return { skipped: true };
  if (run.head_sha !== expectedHead) {
    const commit = await client.get("git/commits/" + run.head_sha);
    if (!Array.isArray(commit.parents) || commit.parents.length !== 2 || !commit.parents.some((parent) => parent.sha === expectedHead)) {
      throw new Error("Producer revision does not match the current PR head or its test merge");
    }
  }
  if (run.conclusion !== "success") return { skipped: true };
  return { repo, run, pr, sha: expectedHead, action: "synchronize" };
}
async function downloadArchive(config, artifact, fetchImpl = globalThis.fetch) {
  if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0 || artifact.expired || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 0 || artifact.size_in_bytes > Math.max(config.limits.compressedBytes, config.limits.unpackedBytes || 0))
    throw new Error("Invalid or oversized artifact metadata");
  const endpoint = config.apiUrl + "/repos/" + config.repository + "/actions/artifacts/" + artifact.id + "/zip";
  let currentUrl = endpoint;
  let response = await fetchImpl(endpoint, {
    redirect: "manual",
    headers: { authorization: "Bearer " + config.sourceToken, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(6e4)
  });
  for (let attempt = 0; [301, 302, 303, 307, 308].includes(response.status); attempt++) {
    if (attempt >= 3) throw new Error("Too many artifact redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("Artifact redirect is missing its destination");
    const redirect = new URL(location, currentUrl);
    if (redirect.protocol !== "https:" || redirect.username || redirect.password)
      throw new Error("Unsafe artifact redirect");
    currentUrl = redirect.href;
    response = await fetchImpl(currentUrl, { redirect: "manual", signal: AbortSignal.timeout(6e4) });
  }
  if (!response.ok || !response.body) throw new Error("Artifact download failed");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > config.limits.compressedBytes)
    throw new Error("Artifact download exceeds compressed limit");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > config.limits.compressedBytes) throw new Error("Artifact download exceeds compressed limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
async function readArtifact(config, producer, client, fetchImpl) {
  const artifacts = await client.list("actions/runs/" + producer.run.id + "/artifacts", "artifacts");
  const matching = artifacts.filter((artifact2) => artifact2.name === config.artifactName && !artifact2.expired);
  if (matching.length !== 1) throw new Error("Expected exactly one named artifact for the verified producer run");
  const artifact = matching[0];
  if (artifact.workflow_run && (artifact.workflow_run.id !== producer.run.id || artifact.workflow_run.head_sha !== producer.run.head_sha))
    throw new Error("Artifact is associated with another run or revision");
  const buffer = await downloadArchive(config, artifact, fetchImpl);
  return readStaticArchive(buffer, {
    limits: config.limits,
    allowedPaths: config.allowedPaths,
    allowedPattern: config.allowedPattern,
    jsonOnly: config.jsonOnly,
    jsonPathPrefix: config.jsonPathPrefix
  });
}
async function saveValidatedFiles(files, root) {
  const directory = await mkdtemp(path.join(root, "verified-static-artifact-"));
  for (const [name, entry] of files) {
    safeArchivePath(name);
    const destination = path.join(directory, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.from(entry.contents, "base64"), { flag: "wx", mode: 384 });
  }
  return directory;
}
async function upsertComment(config, producer, client, result, files) {
  const marker = "<!-- " + config.commentHeader + " -->";
  const prefix = config.pathPrefix ? config.pathPrefix + "/" : "";
  const previewUrl = config.pagesBaseUrl.replace(/\/+$/, "") + "/" + prefix + "pr-" + producer.pr.number + "/";
  let body;
  if (producer.action === "closed") {
    if (!result.removed) return;
    body = marker + "\n" + config.commentTitle + " was removed because this PR is closed.";
  } else {
    body = marker + "\n" + config.commentTitle + ": " + previewUrl;
    const qr = files.get("pr-preview-qr.png");
    if (config.qr && qr && Buffer.from(qr.contents, "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      body += "\n\n[![QR code for the preview](" + previewUrl + "pr-preview-qr.png)](" + previewUrl + ")";
    }
    if (config.commentFooter) body += "\n\n" + config.commentFooter;
  }
  const comments = await client.list("issues/" + producer.pr.number + "/comments");
  const existing = comments.find(
    (comment) => comment.user?.type === "Bot" && comment.user.login === "github-actions[bot]" && typeof comment.body === "string" && comment.body.includes(marker)
  );
  if (existing) await client.request("issues/comments/" + existing.id, "PATCH", { body });
  else await client.request("issues/" + producer.pr.number + "/comments", "POST", { body });
  return previewUrl;
}
async function runTrustedWorker(config, { fetchImpl = globalThis.fetch, event, log = console.log } = {}) {
  const payload = event || JSON.parse(await readFile(config.eventPath, "utf8"));
  const client = createSourceClient(config, fetchImpl);
  const producer = await verifyProducer(config, payload, client);
  if (producer.skipped) return { skipped: true };
  let files = producer.action === "closed" ? /* @__PURE__ */ new Map() : await readArtifact(config, producer, client, fetchImpl);
  if (config.mode === "workflow-run" && producer.action !== "closed")
    files = prepareStaticPreview(files, config.includeSearchIndexes);
  if (config.mode === "download-verified") {
    const current = await client.get("git/ref/heads/" + encodeURIComponent(config.expectedBranch));
    if (current.object?.sha !== producer.sha)
      throw new Error("Default branch changed while downloading the data artifact");
    const directory = await saveValidatedFiles(files, config.tempRoot);
    if (config.outputFile)
      await appendFile(config.outputFile, "artifact-directory=" + directory + "\nsource-sha=" + producer.sha + "\n");
    return { directory, files };
  }
  const stillCurrent = async () => {
    const latest = await client.get("pulls/" + producer.pr.number);
    return latest.base?.repo?.id === producer.repo.id && latest.head?.repo?.id === producer.repo.id && latest.base.ref === config.expectedBranch && (producer.action === "closed" ? latest.state === "closed" : latest.state === "open" && !latest.draft && latest.head.sha === producer.sha);
  };
  const publication = {
    ...config,
    repository: config.targetRepository,
    pr: String(producer.pr.number),
    sha: producer.sha,
    action: producer.action
  };
  const result = await publishFiles(publication, files, { fetchImpl, log, beforeCommit: stillCurrent });
  if (result.skipped || !await stillCurrent()) return { skipped: true };
  const previewUrl = await upsertComment(config, producer, client, result, files);
  if (config.outputFile)
    await appendFile(config.outputFile, "removed=" + result.removed + "\npreview-url=" + (previewUrl || "") + "\n");
  return { ...result, previewUrl };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runTrustedWorker(loadWorkerConfig());
  } catch (error) {
    console.error("::error::" + error.message.replace(/[\r\n]/g, " "));
    process.exitCode = 1;
  }
}
export {
  createSourceClient,
  downloadArchive,
  loadWorkerConfig,
  runTrustedWorker,
  verifyProducer
};
