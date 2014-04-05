### Langolier

Is a lightweight, fast node.js queue processor that makes it easy to index arbitrary data into ElasticSearch, with the assumption it will be viewed using Kibana (see recon-dashboard project).

Example use cases would be tracking software package versions across large or multiple environments, or high-level visibility into AWS resources (EC2, EBS vols, etc.).

#### Overview

Point Langolier at an Amazon SQS queue for consumption and an ElasticSearch instance for writing. It maintains a single worker that long-polls in anticipation for events. Captured events are dispatched to ElasticSearch while the worker immediately returns to listening. The ElasticSearch indexing function fires off a callback to remove the message from the queue upon successful indexing.

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

#### Pending Updates
+ Support Redis as an input queue. This feature is done, but not rolled in yet. Inputs will be modularized.
+ Better logging.
+ Startup options. E.g. verbose or 'to-console' logging.
+ Node.js cluster usage (e.g. multiple indexing workers).
+ Fix settings to handle multiple ElasticSearch indexing nodes.
+ The concept of client-side plugins used to simplify data collection for common items.
+ A client-side, http-based listener/sender for easy queue publishing or testing.

#### FAQ:

Q: Name

A: Yes, it's named after the 90's time-travel horror film with epic graphics. Langolier doesn't care what time it is and will consume anything from anywhere.

Q: *

A: Any concerns are likey the result of an ops person writing code longer than a 5 lines.
