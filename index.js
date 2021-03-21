const Particle = require('particle-api-js');
const particle = new Particle();
const express = require('express')
const bodyParser = require('body-parser')
const jimp = require('jimp');
const os = require('os')
const fileUpload = require('express-fileupload')
const base64 = require('byte-base64')

const PIXEL_MAP = [
    [0,1,5,6,14,15,27,28,44,45,65,66,90,91,119,120],
    [2,4,7,13,16,26,29,43,46,64,67,89,92,118,121,150],
    [3,8,12,17,25,30,42,47,63,68,88,93,117,122,149,151],
    [9,11,18,24,31,41,48,62,69,87,94,116,123,148,152,177],
    [10,19,23,32,40,49,61,70,86,95,115,124,147,153,176,178],
    [20,22,33,39,50,60,71,85,96,114,125,146,154,175,179,200],
    [21,34,38,51,59,72,84,97,113,126,145,155,174,180,199,201],
    [35,37,52,58,73,83,98,112,127,144,156,173,181,198,202,219],
    [36,53,57,74,82,99,111,128,143,157,172,182,197,203,218,220],
    [54,56,75,81,100,110,129,142,158,171,183,196,204,217,221,234],
    [55,76,80,101,109,130,141,159,170,184,195,205,216,222,233,235],
    [77,79,102,108,131,140,160,169,185,194,206,215,223,232,236,245],
    [78,103,107,132,139,161,168,186,193,207,214,224,231,237,244,246],
    [104,106,133,138,162,167,187,192,208,213,225,230,238,243,247,252],
    [105,134,137,163,166,188,191,209,212,226,229,239,242,248,251,253],
    [135,236,164,165,189,190,210,211,227,228,240,241,249,250,254,255]
]

let access_token;
let access_token_expiry;

const byteSize = str => new Blob([str]).size;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const sendUpdate = async (body) => {

    if (!access_token || access_token_expiry < Date.now()) {
        await refreshToken()
    }

    try {
        // total body's going to be 1368 bytes when we turn it into a base64'd string.
        // the particle event limit is 623 bytes per event.
        // we need 4 payloads to fit our data into that limit while ensuring 
        // that we don't split a pixel's data across events.

        const partsPerEvent = 256
        while(body.length) {
            const ints = body.splice(0, partsPerEvent)
            // console.log(JSON.stringify(ints));
            const data = base64.bytesToBase64(new Uint8Array(ints))
            await particle.publishEvent({ name: 'imageUpdate', data, auth: access_token });
            await sleep(1000);
        }
    } catch (e) {
        console.error('Error while queueing update', e)
    }
}

const startServer = async () => {
    try {
        const app = express()
        app.use(bodyParser.json())
        app.use(fileUpload({
            useTempFiles: true,
            tempFileDir: os.tmpdir()
        }));

        const port = process.env.PORT || 8000;
        app.listen(port, () => {
            console.log(`Example app listening at http://localhost:${port}`)
        })

        app.get('/test/half', async (req, res) => {
            const imageData = []
            const max = 16
            const hmax = Math.floor(max/2);
            for (let x = 0; x < max; x++) {
                for (let y = 0; y < max; y++) {
                    imageData.push(PIXEL_MAP[x][y])
                    if (x > hmax && y > hmax) {
                        imageData.push(255, 255, 255)
                    } else {
                        imageData.push(0, 0, 0);
                    }
                }
            }
            await sendUpdate(imageData)
            return res.status(200).send('ok')
        })

        app.get('/test/:x/:y', async(req, res) => {
            const imageData = []
            for(let x=0; x < 16; x++) {
                for (let y = 0; y < 16; y++) {
                    imageData.push(PIXEL_MAP[x][y])
                    if (`${x}` === req.params.x && `${y}` === req.params.y) {
                        imageData.push(255,255,255)
                    } else {
                        imageData.push(0,0,0);
                    }
                }
            }
            await sendUpdate(imageData)
            return res.status(200).send('ok')
        })

        app.post('/upload', async (req, res) => {
            if (!req.files.image.mimetype.includes('image')) {
                res.status(400).error('Invalid file type.')
                return
            }

            if (!req.files.image.size > 10000000) {
                res.status(400).error('Too big.')
                return
            }

            const image = await jimp.read(req.files.image.tempFilePath)
            await image.resize(16, 16, jimp.RESIZE_NEAREST_NEIGHBOR)

            const imageData = []
            for(let x=0; x < image.bitmap.width; x++) {
                for(let y=0; y < image.bitmap.height; y++) {
                    const color = jimp.intToRGBA(image.getPixelColor(x,y));
                    imageData.push(
                        PIXEL_MAP[x][y], // pixel
                        color.r,
                        color.g,
                        color.b
                    )
                }
            }

            await sendUpdate(imageData)
            return res.status(200).send('ok')
        });
    } catch (e) {
        console.error('Could not log in.', e);
        process.exit(1)
    }
}

const refreshToken = async () => {
    try {
        const { body } = await particle.login({ username: process.env.PARTICLE_USERNAME, password: process.env.PARTICLE_PASSWORD })
        access_token = body.access_token
        access_token_expiry = Date.now() + body.expires_in
    } catch(e) {
        console.error('Error while refreshing token', e)
        process.exit()
    }
}

startServer()