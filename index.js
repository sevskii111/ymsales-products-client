require("dotenv").config();

const puppeteer = require("puppeteer-extra");
const fetch = require("node-fetch");
const FormData = require("form-data");
let fs = require("fs");

const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());
const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const serverUrl = process.env.SERVER_URL || "http://localhost:3000/";

const args = process.argv;
const proxyInd = args.indexOf("--proxy");
let proxy, proxyLogin, proxyPassword;
if (proxyInd !== -1) {
  const proxyStr = args[proxyInd + 1].split(":");
  proxy = proxyStr[0] + ":" + proxyStr[1];
  proxyLogin = proxyStr[2];
  proxyPassword = proxyStr[3];
}

const debug = args.indexOf("--debug") !== -1;

let browserConfig = { args: [] };

if (proxy) {
  browserConfig.args.push(`--proxy-server=${proxy}`);
}

if (debug) {
  browserConfig.headless = false;
  browserConfig.args.push(
    "--window-size=1400,900",
    "--remote-debugging-port=9222",
    "--remote-debugging-address=0.0.0.0",
    "--disable-gpu",
    "--disable-features=IsolateOrigins,site-per-process",
    "--blink-settings=imagesEnabled=true"
  );
}

const captchaInd = args.indexOf("--captcha");

let captchaApi;
if (captchaInd !== -1) {
  captchaApi = args[captchaInd + 1];
}

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

  await fetch(`${serverUrl}/category`, {
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
  let browser = await puppeteer.launch(browserConfig);
  let page = (await browser.pages())[0];
  if (proxyLogin) {
    page.authenticate({ username: proxyLogin, password: proxyPassword });
  }

  let target = await (await fetch(`${serverUrl}product`)).text();

  async function parseTarget() {
    await page.goto(`https://pokupki.market.yandex.ru/product/${target}`);
    await page.evaluate(() => {});
    let html = await page.content();

    if (html.length < 600000) {
      if (captchaApi) {
        while (html.length < 600000) {
          console.log("Captcha!");

          const timestamp = Date.now();

          await page.setViewport({
            width: 1400,
            height: 900,
          });

          await page.screenshot({ path: `page.png` });
          const element = await page.$("img"); // объявляем переменную с ElementHandle
          await element.screenshot({ path: `captcha_${timestamp}.png` });

          //const captchaUrl = html.match(/captcha__image"[^"]+"([^"]+)/)[1];

          // const captchaPage = await browser.newPage();

          // await captchaPage.goto(captchaUrl);
          // await captchaPage.evaluate(() => {});
          // await captchaPage.setViewport({
          //   width: 250,
          //   height: 80,
          // });

          // const timestamp = Date.now();

          // await captchaPage.screenshot({ path: `captcha_${timestamp}.png` });
          // captchaPage.close();

          const formData = new FormData();
          formData.append("key", captchaApi);
          formData.append(
            "file",
            fs.createReadStream(`captcha_${timestamp}.png`)
          );

          const id = (
            await fetch("http://rucaptcha.com/in.php", {
              method: "POST",
              body: formData,
            }).then((res) => res.text())
          ).match(/\d+/)[0];

          fs.unlinkSync(`captcha_${timestamp}.png`);

          let solution;

          while (!solution) {
            const res = await fetch(
              `http://rucaptcha.com/res.php?key=${captchaApi}&action=get&id=${id}&json=1`
            ).then((res) => res.text());

            if (res.indexOf("CAPCHA_NOT_READY") === -1) {
              solution = res.substr(3);
            }
          }

          await page.focus("input");
          await page.keyboard.type(solution);
          await page.click("button");

          await page.waitForNavigation();
          console.log(solution);

          await page.evaluate(() => {});
          html = await page.content();

          if (html.length < 600000) {
            await fetch(
              `http://rucaptcha.com/res.php?key=${captchaApi}&action=reportbad&id=${id}`
            );
          } else {
            await fetch(
              `http://rucaptcha.com/res.php?key=${captchaApi}&action=reportgood&id=${id}`
            );
          }
        }
      } else {
        await sleep(60000);
        return;
      }
    }

    console.log(`Parsed ${target}`);
    try {
      const { id, category, img, name, price } = await parseProduct(
        html,
        target
      );
      const rawResponse = await fetch(`${serverUrl}product`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, category, img, name, price }),
      });
      target = await rawResponse.text();
    } catch (e) {
      const rawResponse = await fetch(`${serverUrl}product`, {
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
      });
      target = await rawResponse.text();
    }
  }

  while (true) {
    if (!captchaApi) {
      await sleep(2000);
    }
    await parseTarget();
  }
})();
