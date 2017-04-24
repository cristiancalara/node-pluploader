var multiparty = require('multiparty'),
	events = require('events'),
	util = require('util'),
	Promise = require('bluebird'),
	fs = Promise.promisifyAll(require('fs')),
	mmmagic = require('mmmagic'),
	Magic = mmmagic.Magic;

var FIVE_MINUTES = 1000 * 60 * 5,
	magic = new Magic(mmmagic.MAGIC_MIME_TYPE);

function convertBytesToMegabyes(bytes) {
	return (parseFloat(bytes) / 1024.0) / 1024.0;
}

/**
 * Default callback if not provided
 *
 * @param file
 * @param {Request} req
 * @param {Response} res
 */
function defaultResponse(file, req, res){
	res.json({
		'jsonrpc': '2.0',
		'id': file.name
	});
}

/**
 * Constructor
 *
 * @param {Object} options Currently only acceps "uploadLimit", in M. Default 16M
 */
function Pluploader(options) {
	this.options = options || {
			uploadLimit: 16
		};

	// Store uploads in progress in case chunking occurs.
	this.pendingUploads = {};

	// Initiate stale upload checking
	setInterval(this.deleteStalledUploads.bind(this), FIVE_MINUTES);
}

util.inherits(Pluploader, events.EventEmitter);

/**
 * Check for and delete stale uploads periodically
 */
Pluploader.prototype.deleteStalledUploads = function() {
	var self = this;
	Object.keys(self.pendingUploads).forEach(function(fileName) {

		// create a timestamp representing 5 minutes in the past
		var staleTimestamp = (+new Date()) - FIVE_MINUTES;
		if (self.pendingUploads[fileName].updated > staleTimestamp) {
			return;
		}

		delete self.pendingUploads[fileName];
	});
};

/**
 * Check for and save any pending uploads, delete said uploads from queue after.
 *
 * @param {Request} req
 * @param {Response} res
 * @param fileUploadedCallback
 * @param chunkCallback
 */
Pluploader.prototype.finalizePendingUploads = function(req, res, fileUploadedCallback, chunkCallback) {
	var self = this;

	// even though we are looping through the object we always have a
	// single object in pendingUploads, so we are safe returning the response
	Object.keys(self.pendingUploads).forEach(function(fileIdentifier) {

		var filesData = self.pendingUploads[fileIdentifier];

		if (filesData.chunks != filesData.files.length) {
			return chunkCallback(filesData, req, res);
		}

		delete self.pendingUploads[fileIdentifier];

		var wholeFile = Buffer.concat(filesData.files);

		magic.detect(wholeFile, function(error, mimeType) {
			if (error) {
				return self.emit('error', error);
			}

			return fileUploadedCallback({
				name: filesData.name,
				data: wholeFile,
				size: wholeFile.length,
				type: mimeType
			}, req, res);
		});
	});
};

/**
 * Determine whether the given upload limit has been reached.
 *
 * @param {String} fileIdentifier Key for the pending upload to be inspected.
 */
Pluploader.prototype.uploadLimitReached = function(fileIdentifier) {
	var self = this;
	return new Promise(function(resolve, reject) {
		var totalSize = 0;
		self.pendingUploads[fileIdentifier].files.forEach(function(file) {
			totalSize += file.length;
		});

		resolve(convertBytesToMegabyes(totalSize) > self.options.uploadLimit);
	});
};

/**
 * Add uploaded file or chunk of uploaded
 * file and requisite meta data to the upload queue
 *
 * @param {Request} req
 * @param {Response} res
 * @param fileUploadedCallback
 * @param chunkCallback
 */
Pluploader.prototype.handleRequest = function plupload(req, res, fileUploadedCallback, chunkCallback) {

	var form = new multiparty.Form(this.options),
		self = this;

	// set defaults if not provided
	if (fileUploadedCallback === undefined) {
		fileUploadedCallback = defaultResponse;
	}
	if (chunkCallback === undefined) {
		chunkCallback = defaultResponse;
	}

	form.parse(req, function(err, fields, files) {

		if (!fields.chunk) {
			fields.chunk = [0];
			fields.chunks = [1];
		}

		var name = fields.name[0],
			chunks = fields.chunks[0];

		var fileIdentifier = name + chunks[0];

		if (!self.pendingUploads[fileIdentifier]) {
			self.pendingUploads[fileIdentifier] = {
				name: name,
				files: [],
				updated: +new Date(),
				chunks: chunks
			};
		}

		// TODO find a way to prevent upload from going to FS
		fs.readFileAsync(files.file[0].path)
			.then(function(fileData) {

				self.pendingUploads[fileIdentifier].files.push(fileData);

				self.uploadLimitReached(fileIdentifier).then(function(limitReached) {
					if (limitReached) {
						res.status(413);
						res.json({
							'jsonrpc': '2.0',
							'id': fileData.name,
							'error': {
								code: 500,
								'message': 'File size exceeds upload limit of ' + self.options.uploadLimit + 'M'
							},
						});
					} else {
						self.finalizePendingUploads(req, res, fileUploadedCallback, chunkCallback);
					}
				});
			})
			.error(function(error) {
				self.emit('error', error);
			});
	});
};

module.exports = Pluploader;

