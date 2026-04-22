import fetch from 'node-fetch';

async function testFetch() {
  const url = 'https://www.youtube.com/api/timedtext?v=j51uMah-3js&ei=zaPjabauFpKxsvQP5bWaoQY&caps=asr&opi=112496729&exp=xpe&xoaf=5&xowf=1&xospf=1&hl=en&ip=0.0.0.0&ipbits=0&expire=1776551485&sparams=ip,ipbits,expire,v,ei,caps,opi,exp,xoaf&signature=E13B25E56822F300BCC2490EDFF29A094B606D7A.82EEE960110D3DD99B02D3214BE11FB2BB301415&key=yt8&kind=asr&lang=en&variant=gemini';
  
  const WebUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': WebUA
      }
    });
    console.log('Status:', response.status);
    console.log('Headers:', JSON.stringify([...response.headers.entries()]));
    const text = await response.text();
    console.log('Body Length:', text.length);
    console.log('Body start:', text.substring(0, 500));
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

testFetch();
