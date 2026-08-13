const http = require('http');
const urls = ['http://127.0.0.1:3000/dados', 'http://127.0.0.1:3000/saude', 'http://127.0.0.1:3000/diagnostico'];
let count = 0;
urls.forEach((url) => {
    http.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('URL', url);
            console.log(data);
            console.log('---');
            if (++count === urls.length) process.exit(0);
        });
    }).on('error', (err) => {
        console.error('ERR', url, err.message);
        if (++count === urls.length) process.exit(0);
    });
});