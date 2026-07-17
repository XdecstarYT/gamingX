/* ============================================================================
   GX MIND — starter chatbot data: intents, tokenizer, bag-of-words encoding.
   An "intent" is a category of message (e.g. "greeting") with example
   patterns to train on and canned responses to reply with once the trained
   network recognizes that category.
   ========================================================================== */
window.GXMindData = (() => {
'use strict';

const STARTER_INTENTS = [
  { tag: 'greeting', patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'yo', 'sup', 'howdy'],
    responses: ['Hey there!', 'Hello! How can I help?', "Hi! What's up?"] },
  { tag: 'goodbye', patterns: ['bye', 'goodbye', 'see you', 'see you later', 'farewell', 'gotta go'],
    responses: ['Goodbye!', 'See you later!', 'Take care!'] },
  { tag: 'thanks', patterns: ['thanks', 'thank you', 'appreciate it', 'thanks a lot', 'thx'],
    responses: ["You're welcome!", 'Anytime!', 'No problem at all!'] },
  { tag: 'name', patterns: ['what is your name', 'who are you', 'what are you called', 'your name'],
    responses: ["I'm a tiny neural network you trained yourself.", 'Just a little model running in your browser — no cloud required.'] },
  { tag: 'howareyou', patterns: ['how are you', 'how are you doing', 'how do you feel', 'you good'],
    responses: ['Running smoothly, thanks for asking!', 'All my weights are feeling great.'] },
  { tag: 'joke', patterns: ['tell me a joke', 'make me laugh', 'say something funny', 'do you know any jokes'],
    responses: ['Why did the neural network cross the road? To minimize its loss on the other side.', "I'd tell you a training joke, but it might not converge."] },
  { tag: 'help', patterns: ['help', 'what can you do', 'how does this work', 'how do i use this'],
    responses: ["Type a message and I'll match it to something I learned. Head to the Models tab to teach me new categories and retrain me."] },
  { tag: 'fallback', patterns: [],
    responses: ["I haven't learned how to respond to that yet — add it as training data in the Models tab.", 'Not sure about that one yet. Train me on it?'] },
];

function tokenize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}
function buildVocab(intents) {
  const set = new Set();
  for (const intent of intents) for (const p of intent.patterns) for (const w of tokenize(p)) set.add(w);
  return Array.from(set).sort();
}
function bagOfWords(text, vocab) {
  const tokens = new Set(tokenize(text));
  return vocab.map(w => (tokens.has(w) ? 1 : 0));
}

return { STARTER_INTENTS, tokenize, buildVocab, bagOfWords };
})();
