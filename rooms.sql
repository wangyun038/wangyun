CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  touched INTEGER NOT NULL
);
CREATE INDEX rooms_touched ON rooms(touched);
