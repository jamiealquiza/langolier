var settings = {};
settings.sqs = {};
settings.es = {};


// General
settings.workers = 2;
settings.logFile = '/var/log/langolier.log';
// If logConsole is true, logFile will not be written.
settings.logConsole = false;

// Input: Amazon SQS
settings.sqs.accessKeyId = '';
settings.sqs.secretAccessKey = '';
settings.sqs.region = '';
settings.sqs.sqsUrl = '';

// Output: ElasticSearch
settings.es.index = 'index';
settings.es.host = '127.0.0.1';
settings.es.port = '9200';
settings.es.apiVer = '1.1';

module.exports = settings;
