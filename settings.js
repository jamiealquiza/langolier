var settings = {};
settings.redis = {};
settings.es = {};
settings.aws = {};

// General
settings.index = 'index';
settings.logFile = '/var/log/output.log';

// Input: Amazon SQS
settings.aws.accessKeyId = '';
settings.aws.secretAccessKey = '';
settings.aws.region = '';
settings.aws.sqsUrl = '';

// Output: ElasticSearch
settings.es.host = '127.0.0.1';
settings.es.port = '9200';
settings.es.apiVer = '1.0';

module.exports = settings;
