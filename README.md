# Mediasoup Helloworld

A minimal Client/Server app based on Mediasoup and Socket.io


## Dependencies

* [Mediasoup v3 requirements](https://mediasoup.org/documentation/v3/mediasoup/installation/#requirements)
* Node.js >= v8.6
* [Browserify](http://browserify.org/)


## Run

The server app runs on any supported platform by Mediasoup. The client app runs on a single browser tab.
```
# install dependencies and build mediasoup
npm install

# create the client bundle and start the server app
npm start
```

### Troubleshooting
```
sudo npm install browserify -g
sudo npm cache clean -f
sudo npm install -g n
sudo n stable
```
