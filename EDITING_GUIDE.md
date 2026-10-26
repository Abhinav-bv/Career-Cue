# Editing CareerCue

The project uses plain HTML, CSS, and JavaScript. No build step or package installation is required.

## Where to edit

| What you want to change | File |
| --- | --- |
| Colors, spacing, fonts, cards, and responsive layout | `public/styles.css` |
| Screen text, cards, booking form, question prompts, and frontend behavior | `public/app.js` |
| Browser title and the HTML entry page | `public/index.html` |
| Login, booking, feedback, roles, and data rules | `server.js` |
| Demo accounts and initial interview slots | `seed()` in `server.js` |

## See changes locally

1. Open a terminal in the `CareerCue` folder.
2. Run `npm start` with Node.js 20 or newer.
3. Open `http://localhost:3000`.
4. Save a change to `public/styles.css`, `public/app.js`, or `public/index.html`, then refresh the browser.
5. After changing `server.js`, stop the server and run `npm start` again.

Demo data is stored in `data/careercue.json`. If you need a fresh demo, stop the server and delete this file. The app recreates the sample accounts and slots on the next request. This also removes any bookings and feedback you entered locally.

Run `npm test` after changing booking, feedback, or authorization logic.

