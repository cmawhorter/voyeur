Voyeur.prototype.shutdownSync = function() {
  this.saveSync();
  this.stopSync();
};

var fs = require('fs')
  , path = require('path')
  , EventEmitter = require('events').EventEmitter;

var chokidar = require('chokidar');

var consolelogger = {
    info: console.info
  , warn: console.warn
  , error: console.error
  , debug: console.log
  , log: console.log
};

var nooplogger = {
    info: function(){}
  , warn: function(){}
  , error: function(){}
  , debug: function(){}
  , log: function(){}
};

function Voyeur(opts) {
  opts = opts || {};
  this.options = {
      destination: './watched.json'
    , prettify: true
    , saveEvery: 360000
    , logger: nooplogger
  };
  for (var k in opts) {
    if (k in this.options) {
      this.options[k] = opts[k];
    }
    else {
      throw new Error('Invalid option "' + k + '"');
    }
  }

  this.db = {};
  this.watchers = [];

  this.log = this.options.logger;
  this.log.debug('Initializing', this.options);
}

Voyeur.prototype = Object.create(EventEmitter.prototype);

Voyeur.prototype.start = function(pattern, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }

  var _this = this
    , ready = function(err) {
        _this.emit('ready');
        callback(err);
      };

  Object.freeze(_this.options);
  this.log.debug('Starting');

  fs.exists(_this.options.destination, function(exists) {
    if (exists) {
      _this._load(_this.options.destination, function(err) {
        if (err) {
          return callback(err);
        }
        _this._watch(pattern, options, ready);
        return;
      });
    }
    else {
      _this._watch(pattern, options, ready);
      return;
    }
  });

  if (_this.options.saveEvery) {
    setInterval(function() {
      _this.save(function(err) {
        if (err) {
          throw err;
        }
      });
    }, _this.options.saveEvery);
  }

  return _this;
};

Voyeur.prototype.shutdownSync = function() {
  this.saveSync();
  this.stopSync();
};

Voyeur.prototype.shutdown = function(callback) {
  var _this = this;
  _this.stop(function(err) {
    if (err) {
      return callback(err);
    }
    _this.save(callback);
  });
};

Voyeur.prototype.stop = function(callback) {
  this.stopSync();
  process.setImmediate(callback);
};

Voyeur.prototype.stopSync = function() {
  this.watchers.forEach(function(watcher) {
    watcher.close();
  });
};

Voyeur.prototype._load = function(destination, callback) {
  var _this = this;

  _this.log.debug('Loading', destination);

  fs.readFile(destination, function(err, data) {
    if (err) {
      return callback(err);
    }
    _this.import(JSON.parse(data));
    _this.emit('reload');
    callback(null);
  });
};

Voyeur.prototype._lastModFromStats = function(stats) {
  return stats && stats.mtime && stats.mtime.getTime ? stats.mtime.getTime() : null;
};

Voyeur.prototype._watch = function(globPattern, globOptions, callback) {
  var _this = this;

  _this.log.debug('Watching', globPattern, globOptions);

  var watcher = chokidar.watch(globPattern, globOptions);
  _this.watchers.push(watcher);

  var ready = false;
  watcher
    .on('ready', function() {
      _this.log.debug('Watcher ready');
      ready = true;
      callback(null);
    })
    .on('error', function(err) {
      watcher.close();
      callback(err);
    })
    .on('add', function(filepath, stats) {
      _this.emit('watcher:add', filepath, stats, watcher);
      var lastMod = _this._lastModFromStats(stats);
      if (ready || !_this.test(filepath, lastMod)) {
        _this.add(filepath, lastMod);
      }
    })
    .on('change', function(filepath, stats) {
      _this.emit('watcher:change', filepath, stats, watcher);
      _this.add(filepath, _this._lastModFromStats(stats));
    })
    .on('unlink', function(filepath) {
      _this.emit('watcher:delete', filepath, watcher);
      _this.remove(filepath);
    });
};

Voyeur.prototype.import = function(db) {
  for (var relativePath in db) {
    var item = db[relativePath];
    if (item) {
      this._create(relativePath, item.revision, item.data || {});
    }
  }
  return this;
};

Voyeur.prototype._create = function(relativePath, revision, data) {
  if (!data) {
    throw new Error('Data is required');
  }
  this.db[relativePath] = { revision: revision, data: data };
};

Voyeur.prototype.get = function(relativePath) {
  return this.db[relativePath];
};

Voyeur.prototype.add = function(relativePath, revision, data) {
  // this.log.debug('add', relativePath, revision);
  revision = revision || -Infinity;
  var status = this.test(relativePath, revision);
  if (void 0 === status) {
    var createData = {};
    this._create(relativePath, revision, createData);
    this.emit('create', relativePath, createData);
  }
  else {
    var item = this.get(relativePath)
    this.emit(false === 'status' ? 'current' : 'expired', relativePath, item.data, function acknowledge() {
      if (arguments.length > 0) {
        throw new Error('Acknowledge callback expected zero arguments, received ' + arguments.length);
      }
      item.revision = revision;
    });
  }
  return this;
};

Voyeur.prototype.remove = function(relativePath) {
  // this.log.debug('remove', relativePath);
  if (this.db[relativePath]) {
    this.emit('remove', relativePath, this.db[relativePath].data);
    delete this.db[relativePath];
  }
  return this;
};

Voyeur.prototype.test = function(relativePath, revision) {
  revision = revision || -Infinity;
  if (this.db[relativePath]) { // already exists
    if (revision > (this.db[relativePath].revision || -Infinity)) { // newer version
      return false;
    }
    else {
      return true;
    }
  }
  else {
    return;
  }
};

Voyeur.prototype.stringify = function() {
  return this.options.prettify ? JSON.stringify(this.db, null, 2) : JSON.stringify(this.db);
};

Voyeur.prototype.save = function(destination, callback) {
  destination = destination || this.options.destination;
  fs.writeFile(destination, this.stringify(), callback);
};

Voyeur.prototype.saveSync = function(destination) {
  destination = destination || this.options.destination;
  this.log.debug('saveSync', destination);
  fs.writeFileSync(destination, this.stringify());
};

Voyeur.filesToObjects = function(files) {
  files = files || [];
  var db = {};
  for (var i=0; i < files.length; i++) {
    var relativePath = files[i];
    db[relativePath] = {
        revision: null
      , data: null
    };
  }
  return db;
};

module.exports = Voyeur;
