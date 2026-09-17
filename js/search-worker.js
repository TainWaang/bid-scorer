importScripts('scoring.js');
onmessage = event => {
  try { postMessage({result: Scoring.optimizePriceAcrossScenarios(...event.data)}); }
  catch (error) { postMessage({error: error.message}); }
};
