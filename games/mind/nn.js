/* ============================================================================
   GX MIND — a real, from-scratch feedforward neural network.
   Plain JS, no dependencies: forward pass, backpropagation, gradient descent.
   Small-scale by design (browser-trainable in seconds) — this is genuine
   machine learning, not a large language model.
   ========================================================================== */
window.GXNN = (() => {
'use strict';

function randMatrix(rows, cols, scale) {
  const m = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) row.push((Math.random() * 2 - 1) * scale);
    m.push(row);
  }
  return m;
}
function zeros(n) { return new Array(n).fill(0); }
function matVecMul(W, x) {
  const out = new Array(W.length);
  for (let i = 0; i < W.length; i++) {
    let s = 0;
    const row = W[i];
    for (let j = 0; j < x.length; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}
function addVec(a, b) { return a.map((v, i) => v + b[i]); }
function reluVec(v) { return v.map(x => Math.max(0, x)); }
function softmax(v) {
  const m = Math.max(...v);
  const ex = v.map(x => Math.exp(x - m));
  const s = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map(x => x / s);
}

/* A small multi-layer perceptron: ReLU hidden layers, softmax output,
   cross-entropy loss, trained one example at a time (stochastic gradient
   descent) — simple, transparent, and easy to reason about. */
class DenseNN {
  constructor(sizes) {
    this.sizes = sizes;
    this.W = []; this.b = [];
    for (let l = 0; l < sizes.length - 1; l++) {
      this.W.push(randMatrix(sizes[l + 1], sizes[l], Math.sqrt(2 / sizes[l])));
      this.b.push(zeros(sizes[l + 1]));
    }
  }
  forward(x) {
    const activations = [x];
    let a = x;
    for (let l = 0; l < this.W.length; l++) {
      const z = addVec(matVecMul(this.W[l], a), this.b[l]);
      const isLast = l === this.W.length - 1;
      a = isLast ? softmax(z) : reluVec(z);
      activations.push(a);
    }
    return activations;
  }
  predict(x) { const a = this.forward(x); return a[a.length - 1]; }
  /* one step of backprop + SGD update for a single (x, correct class index) pair.
     returns the cross-entropy loss for this example, for tracking training progress. */
  trainStep(x, yIndex, lr) {
    const activations = this.forward(x);
    const output = activations[activations.length - 1];
    let delta = output.slice();
    delta[yIndex] -= 1; // dL/dz for softmax + cross-entropy simplifies to (output - onehot)
    const grads = [];
    for (let l = this.W.length - 1; l >= 0; l--) {
      const aPrev = activations[l];
      const gW = delta.map(d => aPrev.map(a => d * a));
      const gB = delta.slice();
      grads.unshift({ gW, gB });
      if (l > 0) {
        const Wl = this.W[l];
        const newDelta = new Array(aPrev.length).fill(0);
        for (let j = 0; j < aPrev.length; j++) {
          let s = 0;
          for (let i = 0; i < delta.length; i++) s += Wl[i][j] * delta[i];
          newDelta[j] = aPrev[j] > 0 ? s : 0; // ReLU derivative (activation>0 implies pre-activation>0)
        }
        delta = newDelta;
      }
    }
    for (let l = 0; l < this.W.length; l++) {
      for (let i = 0; i < this.W[l].length; i++) {
        for (let j = 0; j < this.W[l][i].length; j++) this.W[l][i][j] -= lr * grads[l].gW[i][j];
        this.b[l][i] -= lr * grads[l].gB[i];
      }
    }
    return -Math.log(Math.max(1e-9, output[yIndex]));
  }
  toJSON() { return { sizes: this.sizes, W: this.W, b: this.b }; }
  static fromJSON(obj) {
    const nn = new DenseNN(obj.sizes);
    nn.W = obj.W; nn.b = obj.b;
    return nn;
  }
}

return { DenseNN, softmax };
})();
