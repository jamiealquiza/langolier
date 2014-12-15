#!/usr/bin/python3

import redis, json

r = redis.StrictRedis(host='localhost', port=6379, db=0)

while True:
	resp = r.blpop('messages')[1]
	message = json.loads(resp.decode('utf-8'))
	print(message)
