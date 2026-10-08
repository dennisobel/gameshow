-- Clears everything that players created, and keeps everything the show is made of.
--
-- Gone:   users and their sessions, spun games, matches, rounds, every answer a
--         player typed, feedback, and the played/solved counters on questions.
-- Kept:   categories, questions and their answers, the AI generation history, and
--         the cached host voice (paid for, and independent of any player).
--
-- Run with: make reset-players CONFIRM=yes

BEGIN;

DELETE FROM feedback;
DELETE FROM submissions;
DELETE FROM match_rounds;
DELETE FROM matches;
DELETE FROM games;
DELETE FROM refresh_tokens;
-- Everything that points at a user is ON DELETE SET NULL or CASCADE, so the
-- generation history survives with its requester blanked.
DELETE FROM users;

UPDATE questions SET times_served = 0, times_solved = 0;

COMMIT;

SELECT 'users' AS what, count(*) FROM users
UNION ALL SELECT 'games', count(*) FROM games
UNION ALL SELECT 'matches', count(*) FROM matches
UNION ALL SELECT 'questions kept', count(*) FROM questions
UNION ALL SELECT 'cached voice lines kept', count(*) FROM voice_cache;
