const mediasoup = require('mediasoup-client');
const socketClient = require('socket.io-client');
const socketPromise = require('./lib/socket.io-promise').promise;
const config = require('./config');

const hostname = window.location.hostname;

let device;
let socket;
let producer;

const $ = document.querySelector.bind(document);
const $fsPublish = $('#fs_publish');
const $fsSubscribe = $('#fs_subscribe');
const $btnConnect = $('#btn_connect');
const $btnWebcam = $('#btn_webcam');
const $btnScreen = $('#btn_screen');
const $btnSubscribe = $('#btn_subscribe');
const $chkSimulcast = $('#chk_simulcast');
const $txtConnection = $('#connection_status');
const $txtWebcam = $('#webcam_status');
const $txtScreen = $('#screen_status');
const $txtSubscription = $('#sub_status');
let $txtPublish;

$btnConnect.addEventListener('click', connect);
$btnWebcam.addEventListener('click', publish);
$btnScreen.addEventListener('click', publish);
$btnSubscribe.addEventListener('click', subscribe);

if (typeof navigator.mediaDevices.getDisplayMedia === 'undefined') {
  $txtScreen.innerHTML = 'Not supported';
  $btnScreen.disabled = true;
}

async function connect() {
  $btnConnect.disabled = true;
  $txtConnection.innerHTML = 'Connecting...';

  const opts = {
    path: '/server',
    transports: ['websocket'],
  };

  const serverUrl = `https://${hostname}:${config.listenPort}`;
  socket = socketClient(serverUrl, opts);
  socket.request = socketPromise(socket);

  socket.on('connect', async () => {
    console.log('connect')
    $txtConnection.innerHTML = 'Connected';
    $fsPublish.disabled = false;
    $fsSubscribe.disabled = false;

    const data = await socket.request('getRouterRtpCapabilities');
    console.log('Router Rtp Capabilities',data)
    await loadDevice(data);
  });

  socket.on('disconnect', () => {
    console.log('disconnect')
    $txtConnection.innerHTML = 'Disconnected';
    $btnConnect.disabled = false;
    $fsPublish.disabled = true;
    $fsSubscribe.disabled = true;
  });

  socket.on('connect_error', (error) => {
    console.error('could not connect to %s%s (%s)', serverUrl, opts.path, error.message);
    $txtConnection.innerHTML = 'Connection failed';
    $btnConnect.disabled = false;
  });

  socket.on('newProducer', () => {
    console.log('newProducer')
    $fsSubscribe.disabled = false;
  });
}

async function loadDevice(routerRtpCapabilities) {
  try {
    device = new mediasoup.Device();
  } catch (error) {
    if (error.name === 'UnsupportedError') {
      console.error('browser not supported');
    }
  }
  await device.load({ routerRtpCapabilities });
}

async function publish(e) {
  const isWebcam = (e.target.id === 'btn_webcam');
  $txtPublish = isWebcam ? $txtWebcam : $txtScreen;

  const data = await socket.request('createProducerTransport', {
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
  });
  console.log('MediaSoup ProducerTransport',{
    forceTcp: false,
    rtpCapabilities: device.rtpCapabilities,
  },data)
  if (data.error) {
    console.error(data.error);
    return;
  }
  console.log("Creates a Transport to >> SEND << media. Using createWebRtcTransport(...) read from createProducerTransport ")
  const transport = device.createSendTransport(data);
  console.log('createSendTransport',transport)
  transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
    
  console.log('transport.on("connect" / connectProducerTransport',dtlsParameters)
    socket.request('connectProducerTransport', { dtlsParameters })
      .then(callback)
      .catch(errback);
  });

  transport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
    
    try {
  console.log(' -->> socket.request("produce"',{
        transportId: transport.id,
        kind,
        rtpParameters,
      })
      const { id } = await socket.request('produce', {
        transportId: transport.id,
        kind,
        rtpParameters,
      });
  console.log(' <<-- socket.request("produce"',id)
      callback({ id });
    } catch (err) {
      errback(err);
    }
  });

  let stream;
  
  transport.on('connectionstatechange', (state) => {
    
  console.log('publish : transport.on("connectionstatechange"',state)
    
    switch (state) {
      case 'connecting':
        $txtPublish.innerHTML = 'publishing...';
        $fsPublish.disabled = true;
        $fsSubscribe.disabled = true;
      break;

      case 'connected':
        document.querySelector('#local_video').muted = true;
        document.querySelector('#local_video').srcObject = stream;
        $txtPublish.innerHTML = 'published';
        $fsPublish.disabled = true;
        $fsSubscribe.disabled = false;
      break;

      case 'failed':
        transport.close();
        $txtPublish.innerHTML = 'failed';
        $fsPublish.disabled = false;
        $fsSubscribe.disabled = true;
      break;

      default: break;
    }
  });

  try {
    stream = await getUserMedia(transport, isWebcam);
    const tracks = stream.getVideoTracks();
    console.log('getUserMedia',stream,tracks);
    const track = tracks[0];
    const params = { track };
    if ($chkSimulcast.checked) {
      params.encodings = [
        { maxBitrate: 100000 },
        { maxBitrate: 300000 },
        { maxBitrate: 900000 },
      ];
      params.codecOptions = {
        videoGoogleStartBitrate : 1000
      };
    }
    producer = await transport.produce(params);
  } catch (err) {
    $txtPublish.innerHTML = 'failed';
  }
}

async function getUserMedia(transport, isWebcam) {
  if (!device.canProduce('video')) {
    console.error('cannot produce video');
    return;
  }

  let stream;
  try {
    stream = isWebcam ?
      await navigator.mediaDevices.getUserMedia({ video: {
    width: { min: 1024, ideal: 1280, max: 1920 },
    height: { min: 576, ideal: 720, max: 1080 }
  }, audio: {
      sampleSize: 16,
      channelCount: 2,
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true
    } }) : // Share Webcam
      await navigator.mediaDevices.getDisplayMedia({ video: true }); // Share Screen
  } catch (err) {
    console.error('getUserMedia() failed:', err.message);
    throw err;
  }
  return stream;
}

async function subscribe() {
  const data = await socket.request('createConsumerTransport', {
    forceTcp: false,
  });
  console.log('MediaSoup ConsumerTransport',{},data)
  if (data.error) {
    console.error(data.error);
    return;
  }
  console.log("Creates a Transport to >> RECEIVE << media. Using createWebRtcTransport(...) read from createProducerTransport ")
  const transport = device.createRecvTransport(data);
  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    socket.request('connectConsumerTransport', {
      transportId: transport.id,
      dtlsParameters
    })
      .then(callback)
      .catch(errback);
  });

  transport.on('connectionstatechange', async (state) => {
    
  console.log('subscribe : transport.on("connectionstatechange"',state)
  
    switch (state) {
      case 'connecting':
        $txtSubscription.innerHTML = 'subscribing...';
        $fsSubscribe.disabled = true;
        break;

      case 'connected':
        document.querySelector('#remote_video').srcObject = await stream;
        await socket.request('resume');
        $txtSubscription.innerHTML = 'subscribed';
        $fsSubscribe.disabled = true;
        break;

      case 'failed':
        transport.close();
        $txtSubscription.innerHTML = 'failed';
        $fsSubscribe.disabled = false;
        break;

      default: break;
    }
  });

  const stream = consume(transport);
}

async function consume(transport) {
  console.log("Make a media stream from this transport",transport,device)
  const { rtpCapabilities } = device;
  const data = await socket.request('consume', { rtpCapabilities });
  
  console.log("socket.request('consume'",rtpCapabilities,data)
  const {
    producerId,
    id,
    kind,
    rtpParameters,
  } = data;

  let codecOptions = {};
  const consumer = await transport.consume({
    id,
    producerId,
    kind,
    rtpParameters,
    codecOptions,
  });
  
  console.log("transport.consume",consumer)
  
   const stream = new MediaStream();
         stream.addTrack(consumer.track);
  return stream;
}
