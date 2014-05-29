### Langolier

Is a lightweight, fast node.js queue processor that makes it easy to index arbitrary data into ElasticSearch, with the assumption it will be viewed using Kibana (see recon-dashboard project).

Example use cases would be tracking software package versions across large or multiple environments, or high-level visibility into AWS resources (EC2, EBS vols, etc.).

#### Overview

Point Langolier at an Amazon SQS queue for consumption and an ElasticSearch instance for writing. It uses long-polling and batched retrieval (defaults to AWS's current max of 10), with an ability to run multiple concurrent workers. Captured events are dispatched to ElasticSearch bulk indexing while the worker immediately returns to listening. The ElasticSearch indexing function fires off a callback to remove the message from the queue upon successful indexing.

Langolier also uses Node's crypto module to generate message content hash IDs in order to prevent the same item from being stored twice in ElasticSearch. This is important if you're using an AP model / at-least-once-delivery message queue such as SQS.

Messages sent to SQS must follow a specific format:

<pre>
{ "DataType": "some-type", "Message":  { "TimeStamp": "2014-04-02T13:04:01.578-04:00", "some-key": "some-val" } }
</pre>

This format is used to take advantage of ElasticSearch dynamic mapping and Kibana's filtering / search featurs, in lieu of requiring any parsing logic (for now). Your data starts with 'some-key' / 'some-val'; many key-value pairs can be included in each message.

Langolier will index the Message object as-is, using 'DataType' as the ElasticSearch document type. Assuming Langolier was configured to write to an index called 'metadata', the example message would translate to the following curl equivalent:

<pre>
curl -XPOST 'http://127.0.0.1:9200/metadata/some-type/' -d " { "TimeStamp": "2014-04-02T13:04:01.578-04:00", "some-key": "some-val" }"
</pre>

(Note: Kibana should be configured to use the 'TimeStamp' field for time references.)

This allows any number of machines to push arbitrary data to a shared queue for organized storage.

#### Watch it go

Manually pushing message to SQS via AWS console:
![ScreenShot](http://us-east.manta.joyent.com/jalquiza/public/github/langolier-1.png)

Pulled/indexed by Langolier:
<pre>
Fri Apr 04 2014 21:21:39 GMT+0000 (UTC) [INFO]: Connected to ElasticSearch on 10.0.1.35:9200
Fri Apr 04 2014 21:21:54 GMT+0000 (UTC) [INFO]: Listening for events on https://sqs.us-west-2.amazonaws.com/xxx/langolier-xxxxxx
Fri Apr 04 2014 21:21:54 GMT+0000 (UTC) [INFO]: Wrote 1 items to index 'metadata' in 2ms
</pre>

Indexed under respective ElasticSearch type:
![ScreenShot](http://us-east.manta.joyent.com/jalquiza/public/github/langolier-2.png)

Search on fields via ElasticSearch dynamic mapping:
![ScreenShot](http://us-east.manta.joyent.com/jalquiza/public/github/langolier-3.png)


#### Pending Updates
+ Statsd integration
+ Controls on in-flight transaction groups
+ Per-message delete handling based on indexing success
+ Additional / modularized inputs. E.g., Redis is done but not yet rolled in.
+ Multiple inputs / multiple outputs.
+ Fix settings to handle multiple ElasticSearch indexing nodes.
+ Client-side plugins used to simplify data collection for common items.

#### FAQ:

Q: Name

A: Yes, it's named after the 90's time-travel horror film with epic graphics. Langolier doesn't care what time it is and will consume anything from anywhere.

Q: *

A: Any concerns are likey the result of an ops person writing code.
