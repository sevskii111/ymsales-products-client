const puppeteer = require("puppeteer");
const fetch = require("node-fetch");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const [_, __, proxy, proxyLogin, proxyPassword] = process.argv;
if (proxy) {
  console.log(`${proxy} ${proxyLogin} ${proxyPassword}`);
}

async function parseProduct(productPage, productId) {
  const imgRegexp = /avatars\.mds\.yandex\.net\/get-mpic\/(?:[^"]+)/m;
  const nameRegexp = /<h1[^>]+>([^<]+)/m;
  const categoryRegexp = /\d"><meta itemprop="item" id="([^"]+)/m;
  const categoryLinkRegexp = /\d"><meta itemprop="item" id="[^"]+" content="([^"]+)/m;

  const dataPos = productPage.indexOf(
    `data-zone-data="{&quot;productId&quot;:${productId}`
  );
  const pricePos = productPage.indexOf("price", dataPos);
  let price = -1;
  if (pricePos - dataPos < 10000 && pricePos !== -1) {
    price = parseInt(productPage.substr(pricePos, 30).match(/\d+/)[0]);
  }

  const img = productPage.match(imgRegexp)[0];
  const name = productPage.match(nameRegexp)[1];
  const category = productPage.match(categoryRegexp)[1];
  const categoryLink = productPage.match(categoryLinkRegexp)[1];

  await fetch("https://ymsale.herokuapp.com/category", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      category,
      categoryLink,
    }),
  });

  if (price !== -1) {
    return {
      id: productId,
      category: category.split().join(""),
      img: `https://${img}`.split().join("").replace("/orig", "/1hq"),
      name: name.split().join(""),
      price: price,
    };
  } else {
    return {
      id: productId,
      category: category.split().join(""),
      img: `https://${img}`.split().join("").replace("/orig", "/1hq"),
      name: name.split().join(""),
      price: -1,
    };
  }
}

(async function () {
  let browser = proxy
    ? await puppeteer.launch({
        args: [`--proxy-server=${proxy}`],
      })
    : await puppeteer.launch();
  let page = await browser.newPage();
  if (proxyLogin) {
    page.authenticate({ username: proxyLogin, password: proxyPassword });
  }
  page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36 Edg/87.0.664.75"
  );

  let target = await (
    await fetch("https://ymsale.herokuapp.com/product")
  ).text();

  async function parseTarget() {
    await page.goto(`https://pokupki.market.yandex.ru/product/${target}`);
    await page.evaluate(() => {});
    const html = await page.content();

    if (html.length < 600000) {
      console.log("Ban!");
      await browser.close();
      await sleep(600000);
      browser = proxy
        ? await puppeteer.launch({
            args: [`--proxy-server=${proxy}`],
          })
        : await puppeteer.launch();
      page = await browser.newPage();
      if (proxyLogin) {
        page.authenticate({ username: proxyLogin, password: proxyPassword });
      }
      page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.141 Safari/537.36 Edg/87.0.664.75"
      );
      target = await (await fetch("https://ymsale.herokuapp.com")).text();
    } else {
      console.log(`Parsed ${target}`);
      try {
        const { id, category, img, name, price } = await parseProduct(
          html,
          target
        );
        const rawResponse = await fetch(
          "https://ymsale.herokuapp.com/product",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ id, category, img, name, price }),
          }
        );
        target = await rawResponse.text();
      } catch (e) {
        const rawResponse = await fetch(
          "https://ymsale.herokuapp.com/product",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: target,
              category: "",
              img: "",
              name: "",
              price: -1,
            }),
          }
        );
        target = await rawResponse.text();
      }
    }
  }

  while (true) {
    await sleep(2000);
    await parseTarget();
  }
})();
