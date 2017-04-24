# node-pluploader

Handles Plupload's chunked uploads so you don't have to.

This fork moves out from using an event on successful upload, and allow the user to provide a callback for when the file is uploaded. Useful in cases where you need to return some information after uploading the file e.g. media id

You can also set a callback for each chunk.

## Example

```JavaScript
var Pluploader = require('node-pluploader');

// These options are also passed through to multiparty Form
// instances. See https://github.com/andrewrk/node-multiparty#multipartyform
var pluploader = new Pluploader({
  // Optional - defaults to 16. Expressed in MB
  uploadLimit: 16,
  // Optional - defaults to os.tmpDir()
  uploadDir: '/custom/upload-directory'
});

/*
  * Emitted when an error occurs
  *
  * @param error {Error} The error
  */
pluploader.on('error', function(error) {
    throw error;
});

// This example assumes you're using Express
app.post('/upload', function(req, res){
  pluploader.handleRequest(req, res, function(file, req, res) {
        var media = new Media({
            type: file.type,
            size: file.size,
            data: file.data
        });
        
        media.save(function (err, updatedMedia) {
          if (err) {
          	res.json({
                'jsonrpc': '2.0',
                'error': {
                    code: 500,
                    'message': 'Unknown error occurred'
                }
            });
          }
         
          // saved!
          res.json({
              'jsonrpc': '2.0',
              'id': updatedMedia.id
          });
        });
  });
});
```

