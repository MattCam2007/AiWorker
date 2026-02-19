function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

module.exports = {
  log:   (...args) => console.log(ts(), ...args),
  warn:  (...args) => console.warn(ts(), ...args),
  error: (...args) => console.error(ts(), ...args),
};
