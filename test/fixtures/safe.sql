SET lock_timeout = '2s';
CREATE INDEX CONCURRENTLY idx ON users (email);
