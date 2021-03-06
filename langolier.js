#!/usr/bin/env node
// The MIT License (MIT)
//
// Copyright (c) 2014 Jamie Alquiza
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
var settings = require('./settings.js');
var fs = require('fs');
var crypto = require('crypto');
var cluster = require('cluster');
var elasticsearch = require('elasticsearch');
var AWS = require('aws-sdk');
var redis = require('redis')

// Debugging opts
var noop = {};
var opts = process.argv.slice(2);

if (opts.indexOf("--noop") !== -1) {
  settings.logConsole = true;
  noop.indexMsg = true;
  noop.clientEs = true;
} else if (opts.indexOf("--test-output") !== -1) {
  settings.logConsole = true;
  noop.clientEs = true;
  noop.indexMsg = true;
  noop.printMsg = true;
  noop.delMsg = true;
} else if (opts.indexOf("--requeue-only") !== -1) {
  settings.logConsole = true;
  noop.clientEs = true;
  noop.indexMsg = true;
  noop.delMsg = true;
}

noop.requeue = true;

// --- Master Process --- //

if (cluster.isMaster) {
  for (var i = 0; i < settings.workers; i++) {
    cluster.fork();
  }

  // Log events indexed on interval
  var eventsHandled = 0;
  var eventsRequeued = 0;
  setInterval(function() {
    if (eventsHandled > 0) {
      writeLog("Last 5s - Events handled: " + eventsHandled + " Events requeued: " + eventsRequeued, "INFO");
    }
    eventsHandled = 0;
    eventsRequeued = 0;
  }, 5000);

  // Process worker messages
  function messageHandler(msg) {
    if (msg.cmd && msg.cmd == 'eventsHandled') {
      eventsHandled += msg.count;
    } else if (msg.cmd && msg.cmd == 'requeued') {
      eventsRequeued++;
    };
  }

  // Event listener for worker messages
  Object.keys(cluster.workers).forEach(function(id) {
    cluster.workers[id].on('message', messageHandler);
  });

  // Respawn failed workers
  cluster.on('exit', function(worker, code, signal) {
    writeLog("Worker died, respawning", "WARN");
    cluster.fork();
  });

} else {

// --- Worker Processes --//

  // --- Init & Misc. --- //

  AWS.config.update({
    accessKeyId: settings.sqs.accessKeyId,
    secretAccessKey: settings.sqs.secretAccessKey,
    region: settings.sqs.region
  });

  function writeLog(message, level) {
    if (settings.logConsole) {
      console.log(Date() + " [" + level + "]: " + message);
    } else {
      fs.appendFile(settings.logFile, Date() + " [" + level + "]: "
        + message + "\n", function (err) {
        if (err) throw err;
      });
    }
  }

  function hashId(input) {
    var hash = crypto.createHash('sha1');
    hash.setEncoding('hex');
    hash.write(input);
    hash.end();
    return hash.read()
  }

  // --- Output: Redis --- //
  clientRedis = redis.createClient(settings.redis.port, settings.redis.host);
  clientRedis.on("error", function(err) {
    writeLog("Error connecting to redis", err);
    noop.requeue = false;
  });
  function requeueMsg(messages) {
    if (noop.requeue) {
      for (var i = 0; i < messages.length; i++) {
        var message = JSON.stringify(messages[i])
        clientRedis.lpush("messages", message, function (err, res) {
          if (err) { 
            writeLog(err, "WARN");
          } else {
            process.send({ cmd: 'requeued' });
          };
        });
      };
    };
  }
  

  // --- Output: ElasticSearch --- //

  // Init
    if (noop.clientEs !== true) {
      var clientEs = new elasticsearch.Client({
        host: settings.es.host + ':' + settings.es.port,
        apiVersion: settings.es.apiVer
      });

      clientEs.ping({ requestTimeout: 1000 }, function (err) {
        if (err) {
          writeLog(err, "WARN");
        } else {
          writeLog("Connected to ElasticSearch on "
          + settings.es.host + ':' + settings.es.port, "INFO");
        };
      });
  }

  // General
  function indexMsg(message, receipts) {
    if (noop.indexMsg !== true) {
      clientEs.bulk({
        body: message
      }, function (err, resp) {
        if (err) {
          writeLog(err, "WARN");
        }
        else {
          writeLog("Wrote "
            + message.length/2
            + " item(s) to index '"
            + settings.es.index
            + "' in " + resp.took + "ms", "INFO");
          delSqsMsg(receipts);
          process.send({ cmd: 'eventsHandled', count: message.length/2 });
        };
      });
    } else {
      if (noop.printMsg === true) {
        console.log(message);
      };
      if (noop.delMsg === true) {
        delSqsMsg(receipts);
      };
      process.send({ cmd: 'eventsHandled', count: message.length/2 });
    }
  };

  // --- Input: AWS SQS --- //

  // Init
  var sqsParams = {
    QueueUrl: settings.sqs.sqsUrl,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 5,
  };

  function estabSqs() {
    clientSqs = new AWS.SQS({region: settings.sqs.region});
    clientSqs.getQueueAttributes({QueueUrl: settings.sqs.sqsUrl}, function(err, data) {
      if (err) {
        writeLog(err, "WARN");
      } else {
        writeLog("Listening for events on " + settings.sqs.sqsUrl, "INFO");
      };
    });
  }

  // General
  function parseSqsMsg(messages) {
    var docs = [];
    var receipts = [];
    var requeueDocs = [];
    var meta = {};
    var doc = {};
    var receipt = {};
    for (var msg = 0; msg < messages.length; msg++) {
      var rcpt = messages[msg].ReceiptHandle;
      try {
        var body = JSON.parse(messages[msg].Body);
        if (body['@type']) {
          var type = body['@type']
          delete body['@type']
          doc = body
          meta = { index: {
            _index: settings.es.index,
            _type: type,
            _id: hashId(JSON.stringify(body)) }
          }
        } else {
          doc = body
          meta = { index: {
            _index: settings.es.index,
            _type: "json",
            _id: hashId(JSON.stringify(body)) }
          }
        };
        if (!(doc['@timestamp'])) {
          doc['@timestamp'] = new Date().toISOString()
        }
      } catch (err) {
      var body = messages[msg].Body;
      meta = { index: {
        _index: settings.es.index,
        _type: "plaintext",
        _id: hashId(body) }
      }
      doc = JSON.parse('{"@timestamp": "'
        + new Date().toISOString()
        + '"}');
      doc['@message'] = JSON.stringify(body.replace(/\n/g, " ").replace(/\n$/, "").trim())
      };
      receipt = { Id: msg.toString(), ReceiptHandle: rcpt };
      docs.push(meta, doc);
      receipts.push(receipt);
      // Docs without meta for requeue
      doc['@type'] = meta['index']['_type']
      requeueDocs.push(doc)
    };
    indexMsg(docs, receipts);
    requeueMsg(requeueDocs);
  }

  function pollSqs() {
    clientSqs.receiveMessage(sqsParams, function (err, data) {
      if (err) {
        writeLog(err, "WARN");
      } else {
        if (data.Messages) {
          parseSqsMsg(data.Messages)
        };
        pollSqs(); // Long-poll for 'WaitTimeSeconds', loop on message receipt
      };
    });
  };

  // Called on successful ES indexing
  function delSqsMsg(receipts) {
    clientSqs.deleteMessageBatch({
      QueueUrl: settings.sqs.sqsUrl,
      Entries: receipts
    }, function(err, resp) {
      if (err) writeLog(err, "WARN")
    });
  };

  // Service
  estabSqs(); // Initial connection
  setInterval(estabSqs, 300000); // Refresh conn; AWS API has 15 min timeout
  pollSqs();

}
