#!/usr/bin/env sh
set -eu

kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists --topic payments.commands.v1 --partitions 3 --replication-factor 1
kafka-topics --bootstrap-server kafka:9092 --create --if-not-exists --topic payments.results.v1 --partitions 3 --replication-factor 1
