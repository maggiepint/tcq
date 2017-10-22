import { Router } from 'express';
import passport from './passport';
import * as express from 'express';
import uuid = require('uuid');
import { isChair } from './chairs';
import Meeting from '../shared/Meeting';
import { ensureLoggedIn } from 'connect-ensure-login';
import { resolve as resolvePath } from 'path';
import { promisify } from 'util';
import { readFile } from 'fs';
import { createMeeting, getMeeting } from './db';
import * as b64 from 'base64-url';
import User, { getByUsername, fromGHAU, getByUsernames } from './User';
const rf = promisify(readFile);

function wrap(fn: (req: express.Request, res: express.Response) => Promise<void>) {
  return function(req: express.Request, res: express.Response, next: any): void {
    fn(req, res)
      .then(() => {
        console.log('in wrapper, nexting');
        //return next();
      })
      .catch(next);
  };
}

const router = Router();
router.get('/', async (req, res) => {
  if (req.isAuthenticated()) {
    let user = fromGHAU(req.user);

    let path = resolvePath(__dirname, '../client/new.html');
    let contents = await rf(path, { encoding: 'utf8' });
    contents = contents.replace(
      '/head>',
      '/head><script>window.user = ' + JSON.stringify(user) + '</' + 'script>'
    );
    res.send(contents);
    res.end();
  } else {
    let path = resolvePath(__dirname, '../client/home.html');
    let contents = await rf(path, { encoding: 'utf8' });
    res.send(contents);
    res.end();
  }
});

router.get('/meeting/:id', async (req, res) => {
  if (!req.isAuthenticated()) {
    res.redirect('/login');
    return;
  }

  let meeting;
  try {
    meeting = await getMeeting(req.params.id);
  } catch (e) {
    res.status(404);
    res.send('Meeting not found.');
    res.end();
    return;
  }

  let path = resolvePath(__dirname, '../client/meeting.html');
  let contents = await rf(path, { encoding: 'utf8' });
  let clientData = `<script>window.ghid = "${req.user.ghid}"; window.isChair = ${isChair(
    req.user.ghid
  )}</script>`;

  // insert client data script prior to the first script so this data is available.
  let slicePos = contents.indexOf('<script');
  contents = contents.slice(0, slicePos) + clientData + contents.slice(slicePos);
  res.send(contents);
  res.end();
});

router.post('/meetings', async (req, res) => {
  res.contentType('json');
  let chairs: string = req.body.chairs.trim();

  if (typeof chairs !== 'string') {
    res.status(400);
    res.send({ message: 'Must specify chairs' });
    res.end;
    return;
  }

  // split by commas, trim, and replace leading @ from usernames
  let usernames: string[] = [];
  if (chairs.length > 0) {
    usernames = chairs.split(',').map(s => s.trim().replace(/^@/, ''));
  }

  let chairUsers: User[] = [];
  try {
    chairUsers = await getByUsernames(usernames, req.user.accessToken);
  } catch (e) {
    res.status(400);
    res.send({ message: e.message });
    res.end();
    return;
  }

  let id = b64.encode(
    [
      Math.floor(Math.random() * 2 ** 32),
      Math.floor(Math.random() * 2 ** 32),
      Math.floor(Math.random() * 2 ** 32)
    ],
    'binary'
  );

  let meeting: Meeting = {
    chairs: chairUsers,
    currentAgendaItemId: null,
    currentSpeaker: null,
    agenda: [],
    queuedSpeakers: [],
    id
  };

  await createMeeting(meeting);
  res.send(meeting);
  res.end();
});

router.get('/login', function(req, res) {
  console.log('redirecting');
  res.redirect('/auth/github');
});

router.get('/auth/github', passport.authenticate('github'));
router.get(
  '/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful authentication, redirect home.
    res.redirect('/');
    return;
  }
);

router.get('/logout', function(req, res) {
  req.logout();
  if (req.session) {
    req.session.destroy(() => {
      res.redirect('/');
    });
  }
});

export default router;
