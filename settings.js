var settings = {};
settings.redis = {};
settings.es = {};
settings.aws = {};

// General
settings.index = 'index';
settings.logFile = '/var/log/langolier.log';
// If logConsole is true, logFile will not be written.
settings.logConsole = false;

// Input: Amazon SQS
settings.aws.accessKeyId = '';
settings.aws.secretAccessKey = '';
settings.aws.region = '';
settings.aws.sqsUrl = '';

// Output: ElasticSearch
settings.es.host = '127.0.0.1';
settings.es.port = '9200';
settings.es.apiVer = '1.1';

module.exports = settings;
