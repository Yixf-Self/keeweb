'use strict';

var StorageBase = require('./storage-base');

var GDriveClientId = '847548101761-koqkji474gp3i2gn3k5omipbfju7pbt1.apps.googleusercontent.com';
var NewFileIdPrefix = 'NewFile:';

var StorageGDrive = StorageBase.extend({
    name: 'gdrive',
    enabled: true,
    uipos: 30,
    iconSvg: '<svg xmlns:svg="http://www.w3.org/2000/svg" xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" version="1.1">' +
        '<path d="M120.76421 71.989219 84.87226 9.6679848l-41.828196 0 35.899791 62.3212342zM58.014073 56.294956 37.107816 19.986746 1.2237094 82.284404 ' +
        '22.137808 118.59261Zm-21.415974 63.012814 69.180421 0 20.9141-39.459631-67.635587 0z"/></svg>',

    _baseUrl: 'https://www.googleapis.com/drive/v3',

    getPathForName: function(fileName) {
        return NewFileIdPrefix + fileName;
    },

    load: function(path, opts, callback) {
        var that = this;
        that.stat(path, opts, function(err, stat) {
            if (err) { return callback && callback(err); }
            that.logger.debug('Load', path);
            var ts = that.logger.ts();
            var url = that._baseUrl + '/files/{id}/revisions/{rev}?alt=media'
                .replace('{id}', path)
                .replace('{rev}', stat.rev);
            that._xhr({
                url: url,
                responseType: 'arraybuffer',
                success: function(response) {
                    that.logger.debug('Loaded', path, stat.rev, that.logger.ts(ts));
                    return callback && callback(null, response, { rev: stat.rev });
                },
                error: function(err) {
                    that.logger.error('Load error', path, err, that.logger.ts(ts));
                    return callback && callback(err);
                }
            });
        });
    },

    stat: function(path, opts, callback) {
        var that = this;
        if (path.lastIndexOf(NewFileIdPrefix, 0) === 0) {
            return callback && callback({ notFound: true });
        }
        this._oauthAuthorize(function(err) {
            if (err) {
                return callback && callback(err);
            }
            that.logger.debug('Stat', path);
            var ts = that.logger.ts();
            var url = that._baseUrl + '/files/{id}?fields=headRevisionId'
                .replace('{id}', path);
            that._xhr({
                url: url,
                responseType: 'json',
                success: function(response) {
                    var rev = response.headRevisionId;
                    that.logger.debug('Stated', path, rev, that.logger.ts(ts));
                    return callback && callback(null, { rev: rev });
                },
                error: function(err) {
                    that.logger.error('Stat error', that.logger.ts(ts), err);
                    return callback && callback(err);
                }
            });
        });
    },

    save: function(path, opts, data, callback, rev) {
        var that = this;
        that.stat(path, opts, function(err, stat) {
            if (rev) {
                if (err) { return callback && callback(err); }
                if (stat.rev !== rev) {
                    return callback && callback({revConflict: true}, stat);
                }
            }
            that.logger.debug('Save', path);
            var ts = that.logger.ts();
            var isNew = path.lastIndexOf(NewFileIdPrefix, 0) === 0;
            var url;
            if (isNew) {
                url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,headRevisionId';
                var fileName = path.replace(NewFileIdPrefix, '') + '.kdbx';
                var boundry = 'b' + Date.now() + 'x' + Math.round(Math.random() * 1000000);
                data = new Blob([
                    '--', boundry, '\r\n',
                    'Content-Type: application/json; charset=UTF-8', '\r\n\r\n',
                    JSON.stringify({ name: fileName }), '\r\n',
                    '--', boundry, '\r\n',
                    'Content-Type: application/octet-stream', '\r\n\r\n',
                    data, '\r\n',
                    '--', boundry, '--', '\r\n'
                ], {type: 'multipart/related; boundary="' + boundry + '"'});
            } else {
                url = 'https://www.googleapis.com/upload/drive/v3/files/{id}?uploadType=media&fields=headRevisionId'
                    .replace('{id}', path);
                data = new Blob([data], {type: 'application/octet-stream'});
            }
            that._xhr({
                url: url,
                method: isNew ? 'POST' : 'PATCH',
                responseType: 'json',
                data: data,
                success: function(response) {
                    that.logger.debug('Saved', path, that.logger.ts(ts));
                    var newRev = response.headRevisionId;
                    if (!newRev) {
                        return callback && callback('save error: no rev');
                    }
                    return callback && callback(null, { rev: newRev, path: isNew ? response.id : null });
                },
                error: function(err) {
                    that.logger.error('Save error', path, err, that.logger.ts(ts));
                    return callback && callback(err);
                }
            });
        });
    },

    list: function(callback) {
        var that = this;
        this._oauthAuthorize(function(err) {
            if (err) { return callback && callback(err); }
            that.logger.debug('List');
            var url = that._baseUrl + '/files?fields={fields}&q={q}'
                .replace('{fields}', encodeURIComponent('files'))
                .replace('{q}', encodeURIComponent('fileExtension="kdbx" and trashed=false'));
            var ts = that.logger.ts();
            that._xhr({
                url: url,
                responseType: 'json',
                success: function(response) {
                    if (!response) {
                        that.logger.error('List error', that.logger.ts(ts));
                        return callback && callback('list error');
                    }
                    that.logger.debug('Listed', that.logger.ts(ts));
                    var fileList = response.files.map(function(f) {
                        return {
                            name: f.name,
                            path: f.id,
                            rev: f.headRevisionId
                        };
                    });
                    return callback && callback(null, fileList);
                },
                error: function(err) {
                    that.logger.error('List error', that.logger.ts(ts), err);
                    return callback && callback(err);
                }
            });
        });
    },

    remove: function(path, callback) {
        var that = this;
        that.logger.debug('Remove', path);
        var ts = that.logger.ts();
        var url = that._baseUrl + '/files/{id}'.replace('{id}', path);
        that._xhr({
            url: url,
            method: 'DELETE',
            responseType: 'json',
            statuses: [200, 204],
            success: function () {
                that.logger.debug('Removed', path, that.logger.ts(ts));
                return callback && callback();
            },
            error: function (err) {
                that.logger.error('Remove error', path, err, that.logger.ts(ts));
                return callback && callback(err);
            }
        });
    },

    setEnabled: function(enabled) {
        if (!enabled) {
            this._oauthRevokeToken('https://accounts.google.com/o/oauth2/revoke?token={token}');
        }
        StorageBase.prototype.setEnabled.call(this, enabled);
    },

    _getOAuthConfig: function() {
        var clientId = this.appSettings.get('gdriveClientId') || GDriveClientId;
        return {
            scope: 'https://www.googleapis.com/auth/drive',
            url: 'https://accounts.google.com/o/oauth2/v2/auth',
            clientId: clientId,
            width: 600,
            height: 400
        };
    }
});

module.exports = new StorageGDrive();
