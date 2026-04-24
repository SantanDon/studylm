const fs = require('fs');
const pdf = require('pdf-parse');

async function extract() {
    const dataBuffer = fs.readFileSync('C:\\Users\\Don Santos\\Dropbox\\PC\\Desktop\\DocketDive\\studylm\\uploads\\agent\\agent_1776529462777_41046740-83f5-468f-88cf-690125c3ef9e.pdf');
    try {
        const data = await pdf(dataBuffer);
        console.log('--- START PDF CONTENT ---');
        console.log(data.text);
        console.log('--- END PDF CONTENT ---');
    } catch (err) {
        console.error('PDF Parse error:', err);
    }
}

extract();
