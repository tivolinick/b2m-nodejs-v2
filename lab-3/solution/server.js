'use strict'
const { createLogger, format, transports } = require('winston')
const express = require('express')
const Prometheus = require('prom-client')

const logger = createLogger({
  level: 'debug',
  format: format.combine(
    format.timestamp({
      format: "YYYY-MM-DD'T'HH:mm:ss.SSSZ"
    }),
    format.json()
  ),
  transports: [new transports.Console()]
});

var health = true;
var msg;

const metricsInterval = Prometheus.collectDefaultMetrics()

const app = express()
const port = process.env.PORT || 3003

const checkoutsTotal = new Prometheus.Counter({
  name: 'checkouts_total',
  help: 'Total number of checkouts',
  labelNames: ['payment_method']
})

const httpRequestDurationMicroseconds = new Prometheus.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'code'],
  buckets: [0.10, 5, 15, 50, 100, 200, 300, 400, 500]  // buckets for response time from 0.1ms to 500ms
})

//Runs before each requests
app.use((req, res, next) => {
  res.locals.startEpoch = Date.now()
  next()
})

app.get('/', (req, res, next) => {
var delay = Math.round(Math.random() * 400);
  setTimeout(() => {
   res.json({ status: 'ok', transactionTime: delay + 'ms' })
   next()
 }, delay)
})


app.get('/healthz', (req, res, next) => {
  if(health) {
   res.json({ status: 'ok'})
   next()
 } else {
   next(new Error('Application unhealthy'))
 }
})

app.get('/bad-health', (req, res, next) => {
  health = false
  res.json({ status: 'App health set to \'false\''})
  next()
})

app.get('/checkout', (req, res, next) => {
  const paymentMethod = Math.round(Math.random() * 100) > 20 ? 'card' : 'paypal'
  const errorState =  Math.round(Math.random() * 100) > 20 ? 0 : 1
  var reqDelay = req.query.delay;
  checkoutsTotal.inc({
    payment_method: paymentMethod
  })
  //var delay = reqDelay;
  if (reqDelay) {
  var delay = parseFloat(Math.round(Math.random() * 100)) + parseFloat(reqDelay);
  } else {
    var delay = Math.round(Math.random() * 100)
  }
  if (errorState) {
    msg = 'RSAP0010E: Severe problem detected'
    next(new Error(msg))
    logger.error(msg, {"errCode": "RSAP0010E", "transactionTime": delay})
  } else {
    msg = 'RSAP0001I: Transaction OK'
   setTimeout(() => {
    res.json({ status: msg, transactionTime: delay + 'ms' })
    next()
   }, delay)
   logger.info(msg, {"errCode": "RSAP0001I", "transactionTime": delay})
  }
})

app.get('/metrics', (req, res) => {
  res.set('Content-Type', Prometheus.register.contentType)
  res.end(Prometheus.register.metrics())
})


app.use((err, req, res, next) => {
  res.statusCode = 500
  res.json({ error: err.message })
  next()
})

// Runs after each requests
app.use((req, res, next) => {
  const responseTimeInMs = Date.now() - res.locals.startEpoch

  httpRequestDurationMicroseconds
    .labels(req.method, req.originalUrl, res.statusCode)
    .observe(responseTimeInMs)

  next()
})

const server = app.listen(port, () => {
  console.log(`Example app listening on port ${port}!`)
})

process.on('SIGTERM', () => {
  clearInterval(metricsInterval)

  server.close((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }

    process.exit(0)
  })
})
