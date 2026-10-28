# CareerCue

CareerCue is a peer mock interview and feedback platform built for an individual Software Engineering course project.

![Candidate progress dashboard](screenshots/07-progress.jpg)

## Run

Requires Node.js 20 or newer. No package installation is needed.

```sh
npm start
```

Open http://localhost:3000.

| Role | User ID | Password |
| --- | --- | --- |
| Interviewee (Aarav) | CC1001 | Demo123! |
| Interviewer (Nisha) | CC2001 | Demo123! |
| Interviewer (Kabir) | CC2002 | Demo123! |

Select the matching role on the login page. The demo buttons fill the credentials; press Sign in to continue. Existing local data is upgraded automatically to user IDs without removing bookings or feedback.

Demo data is created automatically in `data/careercue.json` on the first request. To reset the demo, stop the server and delete that file.

## Demo walkthrough

1. Sign in as interviewer CC2001 and open Manage slots. Publish three future slots with a duration and break.
2. Sign in as interviewee CC1001, open Find interviews, filter by topic, and book one of those slots.
3. Open My sessions, cancel that booking, and show its Cancelled history. Book the reopened slot again.
4. Sign back in as CC2001. Open My sessions, review suggested questions, save private notes, and mark the demo interview complete. Open Completed and submit ratings and written feedback.
5. Sign back in as CC1001 and show My progress. Read DEMO_GUIDE.txt for a presentation script and viva preparation.

## Features

- User ID and password login with role-specific interviewee and interviewer views
- Bulk scheduling of 1–8 one-to-one slots, 15–60 minute duration, and configurable breaks
- Topic/status filters and more seeded slots across several days
- Booking, concurrent duplicate-booking prevention, and interviewee schedule conflict checks
- Booking cancellation with confirmation, reopened availability, and cancellation history
- Owner-only slot cancellation that also cancels affected scheduled bookings
- Interview completion and structured feedback
- Interview preparation prompts and saved interviewer notes
- Candidate progress averages and session history
- Persistent local JSON storage and hashed demo passwords

## Architecture

The frontend uses HTML, CSS, and browser JavaScript. The server uses only Node.js built-in modules, serving a small JSON API and storing data locally. The app is designed for a local course demo and does not require an internet connection for core features. The optional Google Font falls back to system fonts offline.

## Test

```sh
npm test
```

The smoke test uses a temporary database and checks user ID login, role permissions, bulk scheduling, interval overlap checks, atomic rejection of conflicting batches, concurrent booking, cancellation, completion, feedback, saved data, and migration of existing data.

To customize the interface or data, see [Editing CareerCue](EDITING_GUIDE.md).

## Course project

Software Engineering (IT_3131), V Semester, CSE Data Science. The project report is distributed separately from this source repository.

