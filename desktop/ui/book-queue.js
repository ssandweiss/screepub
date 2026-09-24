// Turns on a book: one queue per library EPUB, so no two engine calls read
// and write the same book at once.
//
// Three pages write a script's library EPUB. The Settings page's save
// rebuilds it in place (tune.js's reconvert); the Send page's export can
// rebuild it too, on its MOBI rung, and a send or a save copies it; and
// converting the same PDF again writes it afresh (convert.js). Unordered, a
// send could start before a moved knob's rebuild landed and ship the book
// without it, or a rebuild could replace the file under a send reading it.
// So every such engine call takes its turn here, keyed by the EPUB's path.
//
// One queue PER BOOK, not one for the window: a new script's saves must
// not wait out the old script's minute-long KFX export, and an engine call
// that never answers holds up its own book and nothing else.
//
// Pure: no Tauri, no DOM, nothing but promises, so tests drive it directly.

/** book (an EPUB path) -> { last: the newest turn's promise, turns: how many
 *  are queued or running, holder: the label of the one running }. A book
 *  with nothing queued has no entry, so this never grows past the books
 *  that are busy right now. */
const queues = new Map();

/** What a page still owes the books, run before any turn is asked for. */
const owed = new Set();

/** Register work a page owes before any other turn on a book may start:
 *  tune.js's settle, still counting down after a knob moved, is cut short
 *  here so its save joins its book's queue AHEAD of the turn being asked
 *  for, and what is sent is what the reader last set. The same function
 *  registered twice is kept once. A hook must not throw. */
export function beforeEveryTurn(hook) {
  owed.add(hook);
}

/** Run `work` once every turn already queued for `book` has finished,
 *  however it finished, and hand back `work`'s own promise: its answer, or
 *  its failure, reaches the caller as it was, and a failure never stops the
 *  queue. With nothing queued for the book, `work` starts at once, in the
 *  caller's own tick, as it would with no queue at all. `label` names what
 *  the turn is ('save', 'send', 'copy', 'convert'), so a page whose turn is
 *  waiting can say what for (holder()).
 *
 *  `work` must not ask for a turn on the same book from inside itself: it
 *  would wait for itself. */
export function inTurn(book, label, work) {
  for (const hook of owed) hook();
  let queue = queues.get(book);
  if (queue === undefined) {
    queue = { last: Promise.resolve(), turns: 0, holder: null };
    queues.set(book, queue);
  }
  const start = () => {
    queue.holder = label;
    return work();
  };
  let turn;
  if (queue.turns === 0) {
    try {
      turn = Promise.resolve(start());
    } catch (err) {
      turn = Promise.reject(err);
    }
  } else {
    turn = queue.last.catch(() => {}).then(start);
  }
  queue.turns += 1;
  queue.last = turn;
  const done = () => {
    queue.turns -= 1;
    if (queue.turns === 0 && queues.get(book) === queue) queues.delete(book);
  };
  turn.then(done, done);
  return turn;
}

/** The label of the turn holding `book` right now, or null when nothing is
 *  queued for it. */
export function holder(book) {
  return queues.get(book)?.holder ?? null;
}
