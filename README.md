Langolier
========

Is sort of a place-holder service and being replaced with a larger, more powerful tool.

# Overview

Is a fast / lightweight SQS queue processor that makes it easy to index arbitrary data into ElasticSearch (e.g. data produced by [Ascender](https://github.com/jamiealquiza/ascender)).

Point Langolier at an Amazon SQS queue for consumption and an ElasticSearch instance for indexing. A pool of workers performs long-polling, batched retrieval (defaults to AWS SQS's current max of '10') and bulk indexing into ElasticSearch. Messages are only removed from the queue upon successful indexing.

Langolier generates message content hash IDs in order to prevent the same item from being stored twice in ElasticSearch as a result of multiple producer sends or multiple queue delivery scenarios.

While Langolier is intended for ad-hoc collection jobs, it can scale vertically (across many cores via the node cluster module - see 'settings.workers') to handle sustained levels of throughput: a single EC2 c3.xlarge instance setup is able to dequeue/process roughly 2,400+ events/sec. SQS does impose some connections per IP limits, so it's advisable to scale horizontally if you're exceeding ~12 workers for a given node.

# Usage

Langolier writes all messages to the configured index ('settings.es.index' - rolling indices pending). It expects messages in one of three formats: plain-text, json and tagged json.

**plain-text**:

Is indexed under the 'plaintext' type. A '@timestamp' field is appended at indexing time. Multi-line messages are converted to single-line.

**json**:

Is indexed under the 'json' type. A '@timestamp' field is appended at indexing time. Json structure is dynamically mapped within ElasticSearch; all key-value pairs become document fields/values.

**tagged json**:

Langolier can take action on json tagged with special keys. Currently, the '@timestamp' and '@type' special keys exist. The '@timestamp' key allows a user-specified timestamp override, rather than using the time of indexing. The '@type' allows the message to be stored in a specific type rather than the automatic 'plaintext' and 'json' types. The remainder json structure is dynamically mapped within ElasticSearch.

For instance, the following would get stored under the 'package-versions' type:
<pre>
{ "@type": "package-versions", "versions":  { "some-software": "1.0.3-10", "other-software": "2.0.1-0" } }
</pre>

While the following would be indexed under the generic 'json' type:
<pre>
{ "versions": { "some-software": "1.0.3-10", "other-software": "2.0.1-0" } }
</pre>

### Test Mode

The '--test-output' mode will pop (and remove) messages from the queue and print the output to console, rather than indexing (it entirely skips opening connections to ElasticSearch). This is used to review how data is being parsed; you can see the exact object structure as it would be fed into ElasticSearch to ensure types or field/value pairs are being formatted as intended.

Feeding data into SQS via [Ascender](https://github.com/jamiealquiza/ascender):
<pre>
% echo '{ "isThisJsonGood": "yes!" }' | nc localhost 6030
Request Received: 29 bytes
</pre>

Test Mode output:
<pre>
% node ./langolier.js --test-output                            
Tue Nov 04 2014 15:19:55 GMT-0700 (MST) [INFO]: Listening for events on ttps://sqs.us-west-2.amazonaws.com/xxx/langolier
[ { index: 
     { _index: 'recon-testing',
       _type: 'json',
       _id: '25fd6b8eb5a523ac6ed0c8cf713253f94122fee5' } },
  { isThisJsonGood: 'yes!',
    '@timestamp': '2014-11-04T22:20:44.341Z' } ]
</pre>


### No Op Mode

Langolier has a '--noop' flag that can be passed in if you want to test SQS connectivity or dequeue performance of a particular setup. It will set logging to console, disable indexing (and skips opening connections ElasticSearch) and disable delete receipts from being sent to SQS (meaning messages will not be removed).

<pre>
 % ./langolier.js --noop
Sat May 31 2014 13:51:26 GMT-0400 (EDT) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/xxx/langolier
Sat May 31 2014 13:51:26 GMT-0400 (EDT) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/xxx/langolier
Sat May 31 2014 13:51:26 GMT-0400 (EDT) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/xxx/langolier
Sat May 31 2014 13:51:26 GMT-0400 (EDT) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/xxx/langolier
Sat May 31 2014 13:51:30 GMT-0400 (EDT) [INFO]: Events handled, last 5s: 240
Sat May 31 2014 13:51:35 GMT-0400 (EDT) [INFO]: Events handled, last 5s: 370
Sat May 31 2014 13:51:40 GMT-0400 (EDT) [INFO]: Events handled, last 5s: 360
Sat May 31 2014 13:51:45 GMT-0400 (EDT) [INFO]: Events handled, last 5s: 360
</pre>

# Example using Langolier + [Ascender](https://github.com/jamiealquiza/ascender)

**Sending messages into a local Ascender instance**:

Client:
<pre>
% echo 'a string' | nc localhost 6030
Request Received: 9 bytes
% echo 'a multi                      
quote> line
quote> string' | nc localhost 6030
Request Received: 20 bytes
% echo '{ "@timestamp": "'$(date +%s)'", "user": "timestamp" }' | nc localhost 6030            
Request Received: 52 bytes
% echo '{ "@timestamp": "'$(date +%s)'", "@type": "user-type", "key": "value" }' | nc localhost 6030
Request Received: 69 bytes
</pre>

Server:
<pre>
% ./ascender
2014/10/29 11:07:33 Ascender listening on localhost:6030
2014/10/29 11:07:34 Connected to queue: https://sqs.us-west-2.amazonaws.com/000/langolier-testing
2014/10/29 11:07:34 Connected to queue: https://sqs.us-west-2.amazonaws.com/000/langolier-testing
2014/10/29 11:07:34 Connected to queue: https://sqs.us-west-2.amazonaws.com/000/langolier-testing
2014/10/29 17:50:13 Last 5s: sent 1 messages | Avg: 0.20 messages/sec. | Send queue length: 0
2014/10/29 17:50:28 Last 5s: sent 1 messages | Avg: 0.20 messages/sec. | Send queue length: 0
2014/10/29 17:50:38 Last 5s: sent 1 messages | Avg: 0.20 messages/sec. | Send queue length: 0
2014/10/29 17:50:43 Last 5s: sent 1 messages | Avg: 0.20 messages/sec. | Send queue length: 0
</pre>

**Langolier pulling & indexing messages**:
<pre>
% node langolier.js 
Wed Oct 29 2014 23:49:54 GMT+0000 (UTC) [INFO]: Connected to ElasticSearch on 10.0.1.10:9200
Wed Oct 29 2014 23:49:54 GMT+0000 (UTC) [INFO]: Connected to ElasticSearch on 10.0.1.10:9200
Wed Oct 29 2014 23:49:54 GMT+0000 (UTC) [INFO]: Connected to ElasticSearch on 10.0.1.10:9200
Wed Oct 29 2014 23:49:55 GMT+0000 (UTC) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/000/langolier-testing
Wed Oct 29 2014 23:49:55 GMT+0000 (UTC) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/000/langolier-testing
Wed Oct 29 2014 23:49:55 GMT+0000 (UTC) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/000/langolier-testing
Wed Oct 29 2014 23:50:09 GMT+0000 (UTC) [INFO]: Wrote 1 item(s) to index 'langolier-testing' in 320ms
Wed Oct 29 2014 23:50:10 GMT+0000 (UTC) [INFO]: Events handled, last 5s: 1
Wed Oct 29 2014 23:50:23 GMT+0000 (UTC) [INFO]: Wrote 1 item(s) to index 'langolier-testing' in 1ms
Wed Oct 29 2014 23:50:25 GMT+0000 (UTC) [INFO]: Events handled, last 5s: 1
Wed Oct 29 2014 23:50:33 GMT+0000 (UTC) [INFO]: Wrote 1 item(s) to index 'langolier-testing' in 6ms
Wed Oct 29 2014 23:50:35 GMT+0000 (UTC) [INFO]: Events handled, last 5s: 1
Wed Oct 29 2014 23:50:38 GMT+0000 (UTC) [INFO]: Wrote 1 item(s) to index 'langolier-testing' in 5ms
</pre>

**Messages viewed in Kibana**:

Notice which type each message was stored under (either automatically or via tagged json override) and plaintext/json to ElasticSearch document mapping.

![ScreenShot](http://us-east.manta.joyent.com/jalquiza/public/github/langolier-testing.png)

# To Do
+ Could use some refactoring
+ Additional special json tags
+ Statsd integration
+ Better internal throttling based on latency or endpoint health
+ Per-message (rather than per batch) delete handling
+ Fix settings to handle multiple ElasticSearch indexing nodes
