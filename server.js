const mediasoup = require('mediasoup');
const fs = require('fs');
const https = require('https');
const express = require('express');
const socketIO = require('socket.io');
const config = require('./config');
const scribbles = require('scribbles');

// Global variables
let worker;
let webServer;
let socketServer;
let expressApp;
let producer;
let consumer;
let producerTransport;
let consumerTransport;
let mediasoupRouter;

(async () => {
  try {
    await runExpressApp();
    await runWebServer();
    await runSocketServer();
    await runMediasoupWorker();
  } catch (err) {
                                                                                    scribbles.error(err);
  }
})();

async function runExpressApp() {
  expressApp = express();
  expressApp.use(express.json());
  expressApp.use(express.static(__dirname));

  expressApp.use((error, req, res, next) => {
    if (error) {
                                                                                    scribbles.warn('Express app error,', error.message);

      error.status = error.status || (error.name === 'TypeError' ? 400 : 500);

      res.statusMessage = error.message;
      res.status(error.status).send(String(error));
    } else {
      next();
    }
  });
} // END runExpressApp

async function runWebServer() {
  const { sslKey, sslCrt } = config;
  if (!fs.existsSync(sslKey) || !fs.existsSync(sslCrt)) {
                                                                                  scribbles.error('SSL files are not found. check your config.js file');
    process.exit(0);
  }
                                                                                scribbles.info('SSL files OK');
  
  const tls = {
    cert: fs.readFileSync(sslCrt),
    key: fs.readFileSync(sslKey),
  };
  webServer = https.createServer(tls, expressApp);
  webServer.on('error', (err) => {
                                                                                  scribbles.error('starting web server failed:', err.message);
  });

  await new Promise((resolve) => {
    const { listenIp, listenPort } = config;
    webServer.listen(listenPort, listenIp, () => {
      const listenIps = config.mediasoup.webRtcTransport.listenIps[0];
      const ip = listenIps.announcedIp || listenIps.ip;
                                                                                  scribbles.log('server is running');
                                                                                  scribbles.log(`open https://${ip}:${listenPort} in your web browser`);
      resolve();
    });
  }); // END new Promise
} // END runWebServer

async function runSocketServer() {
  socketServer = socketIO(webServer, {
    serveClient: false,
    path: '/server',
    log: false,
  });

  socketServer.on('connection', (socket) => { // Fired when you hit the connection Button
                                                                                    scribbles.log('client connected', producer); // A

    // inform the client about existence of producer
    if (producer) {
      socket.emit('newProducer');
    }

    socket.on('disconnect', () => {
                                                                                  scribbles.log('client disconnected');
    });

    socket.on('connect_error', (err) => {
                                                                                scribbles.error('client connection error', err);
    });

    socket.on('getRouterRtpCapabilities', (data, callback) => {
                                                    scribbles.log('RTP capabilities',mediasoupRouter.rtpCapabilities);
      callback(mediasoupRouter.rtpCapabilities);
    });

    socket.on('createProducerTransport', async (data, callback) => {
                                                          scribbles.log('createProducerTransport');
        try {
          const { transport, params } = await createWebRtcTransport();
          producerTransport = transport;
          callback(params);
        } catch (err) {
                                              scribbles.error(err);
          callback({ error: err.message });
        }
      
    });

    socket.on('createConsumerTransport', async (data, callback) => {
                                                                     scribbles.log('createConsumerTransport');
      try {
        const { transport, params } = await createWebRtcTransport();
        consumerTransport = transport;
        callback(params);
      } catch (err) {
                                                scribbles.error(err);
        callback({ error: err.message });
      }
    });

    socket.on('connectProducerTransport', async (data, callback) => {
                                                                            scribbles.log('connectProducerTransport');
      await producerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('connectConsumerTransport', async (data, callback) => {
      scribbles.log('connectConsumerTransport');
      await consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
      callback();
    });

    socket.on('produce', async (data, callback) => {
                                                     scribbles.log('produce',data);
      const {kind, rtpParameters} = data;
      producer = await producerTransport.produce({ kind, rtpParameters });
      callback({ id: producer.id });

      // inform clients about new producer
      socket.broadcast.emit('newProducer');
    });

    socket.on('consume', async (data, callback) => {
                                                      scribbles.log('consume');
      callback(await createConsumer(producer, data.rtpCapabilities));
    });

    socket.on('resume', async (data, callback) => {
                                                      scribbles.log('resume');
      await consumer.resume();
      callback();
    });
  });
} // END runSocketServer

async function runMediasoupWorker() {
  const createWorkerSettings = {
    logLevel: config.mediasoup.worker.logLevel,
    logTags: config.mediasoup.worker.logTags,
    rtcMinPort: config.mediasoup.worker.rtcMinPort,
    rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
  }
                                    scribbles.log("Creates a new worker with the given settings.",createWorkerSettings) // 1
  worker = await mediasoup.createWorker(createWorkerSettings);

  worker.on('died', () => {
                                     scribbles.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
    setTimeout(() => process.exit(1), 2000);
  });

  const mediaCodecs = config.mediasoup.router.mediaCodecs;
  mediasoupRouter = await worker.createRouter({ mediaCodecs });
                                    scribbles.log("Creates a new router from the WORKER", mediaCodecs,mediasoupRouter)
} // END runMediasoupWorker

async function createWebRtcTransport() {
  const {
    maxIncomingBitrate,
    initialAvailableOutgoingBitrate
  } = config.mediasoup.webRtcTransport;

                                      scribbles.log("Creates a new WebRTC transport.",{
                                        maxIncomingBitrate,
                                        initialAvailableOutgoingBitrate
                                      });
  const transport = await mediasoupRouter.createWebRtcTransport({
    listenIps: config.mediasoup.webRtcTransport.listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate,
  });
  if (maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(maxIncomingBitrate);
    } catch (error) {
    }
  }
  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    },
  };
} // END createWebRtcTransport

async function createConsumer(producer, rtpCapabilities) {
  if (!mediasoupRouter.canConsume(
    {
      producerId: producer.id,
      rtpCapabilities,
    })
  ) {
                                 scribbles.error('can not consume');
    return;
  }
  try {
    consumer = await consumerTransport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: producer.kind === 'video',
    });
                                  scribbles.log("Receive! an VIDEO track from the router.",{
                                    producerId: producer.id,
                                    rtpCapabilities,
                                    paused: producer.kind === 'video',
                                  },consumer)
  } catch (error) {
                                  scribbles.error('consume failed', error);
    return;
  } // END catch

  if (consumer.type === 'simulcast') {
    await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
  }

  return {
    producerId: producer.id,
    id: consumer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
    type: consumer.type,
    producerPaused: consumer.producerPaused
  };
} // END createConsumer
