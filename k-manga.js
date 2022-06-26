const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs')
const path = require('path')
const cac = require('cac')
const os = require('os')
const findChrome = require('./find-chrome')
const platform = os.platform()
const cli = cac('kmanga-downloader')
cli.option('--config [path]', 'path for config file')
cli.option('--mail [mail]', 'Account mail')
cli.option('--password [password]', 'Account password')
cli.option('--out [path]', 'output directory (default: manga)')
cli.option('--url [url]', 'Download manga url.')
cli.help()
const cliOptions = cli.parse().options
if (cliOptions.help) {
  process.exit()
}
let options = cliOptions

/** @type {import('puppeteer').Page} */
let page
main()
  .catch(err => console.log(err))
  .finally(() => {
    console.log('end')
    process.exit()
  })

async function main() {
  options = await readOptions(cliOptions)
  if (!options.url) {
    process.exit()
  }
  puppeteer.use(StealthPlugin())
  const launchOption = {
    userDataDir: options.userDataDir,
    headless: options.headless,
    defaultViewport: {
      height: 800,
      width: 720,
    },
  }
  const chromium = await findChrome()
  launchOption.executablePath = chromium.executablePath
  const browser = await puppeteer.launch(launchOption)
  page = await browser.newPage()
  page.on('request', req => {
    const type = req.resourceType()
    if (['image', 'stylesheet', 'font'].includes(type)) {
      req.abort()
    } else {
      req.continue()
    }
  })
  await page.setDefaultTimeout(0)
  await page.setRequestInterception(true)
  if (options.mail || options.password) {
    await login(options.mail, options.password)
  }
  await saveBook(options.url)
}

async function saveBook(url) {
  const bookId = new URL(url).pathname.split('/')[4]
  const bookTitle = sanitizePath(await getBookTitle(bookId))
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#ind-current-page')
  await page.waitForSelector('#ind-total-pages')
  await movePageToFirst()
  const totalPages = await page.$eval('#ind-total-pages', el => Number(el.textContent))
  await page.waitForTimeout(1000)
  const bookInfo = await getBookInfo()
  const chapterTitle = `${bookTitle}(${bookInfo.chapterId})`
  const distDir = path.resolve(options.out, bookTitle, chapterTitle)
  await fs.promises.mkdir(distDir, { recursive: true })
  let currentPageCount = 0
  while (currentPageCount < totalPages) {
    await page.waitForTimeout(1000)
    await page.waitForSelector('#guard', { hidden: true })
    const imageList = await getImageList()
    for (const image of imageList) {
      if (image == null) continue
      await saveImage(path.resolve(distDir, `${++currentPageCount}.jpg`), image)
      process.stdout.write(`\r${chapterTitle} ${currentPageCount}/${totalPages}`)
    }
    await page.keyboard.press('ArrowLeft')
  }
  process.stdout.write('\n')
}

async function getImageList() {
  return await page.$$eval('.nv-pvImageCanvas', async (pvDivs) => {
    return pvDivs
      .filter(div => getComputedStyle(div).opacity == '1')
      .sort((div1, div2) => {
        const matrix1 = new WebKitCSSMatrix(getComputedStyle(div1).transform)
        const matrix2 = new WebKitCSSMatrix(getComputedStyle(div2).transform)
        return matrix2.m41 - matrix1.m41
      })
      .map(div => div.querySelector('canvas')?.toDataURL())
  })
}

async function movePageToFirst() {
  const isFirstPage = await page.evaluate(() => document.querySelector('#ind-current-page').textContent == '1')
  if (isFirstPage) {
    return
  }
  await page.waitForSelector('#indicator-area', { visible: true })
  await page.hover('#indicator-area')
  await page.waitForSelector('#bottom-menu', { visible: true })
  const sliderRect = await page.evaluate(() => document.querySelector('#slider').getBoundingClientRect().toJSON())
  await page.hover('#slider-btn')
  await page.waitForFunction(() => document.querySelector('#slider-area').style.cursor != 'default')
  await page.mouse.down()
  await page.mouse.move(sliderRect.x + sliderRect.width + 20, sliderRect.y, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('#ind-current-page').textContent == '1')
}

function getBookInfo() {
  return page.evaluate(() => {
    const searchParams = new URL(location.href).searchParams
    const xid = searchParams.get('p5')
    const info = JSON.parse(atob(xid))
    return info
  })
}

async function getBookTitle(bookId) {
  const url = `https://comic.k-manga.jp/title/${bookId}/pv`
  await page.goto(url)
  await page.waitForSelector('.book-info--title')
  await page.waitForTimeout(1000)
  return page.$eval('.book-info--title > span', el => el.textContent)
}

async function saveImage(dist, image) {
  if (!fs.existsSync(dist)) {
    await fs.promises.writeFile(dist, image.replace(/^data:image\/\w+;base64,/, ''), {
      encoding: 'base64'
    })
  }
}

async function login(mail, pass) {
  console.log('login...')
  await page.goto('https://comic.k-manga.jp/login/mail', { waitUntil: 'domcontentloaded' })
  await page.type('#login_mail', mail)
  await page.type('#login_password', pass)
  await page.click('form[name=login] .form-base--submit', { delay: 500 })
  await page.waitForNavigation({ waitUntil: 'domcontentloaded' })
}

function sanitizePath(sPath) {
  if (platform.indexOf('win') === 0) {
    sPath = sPath.replace(/[\\/:*?"<>|\r\n\t]/g, '')
  }
  if (platform.indexOf('linux') === 0) {
    sPath = sPath.replace(/[/\r\n\t]/g, '')
  }
  if (platform.indexOf('darwin') === 0) {
    sPath = sPath.replace(/[/:\r\n\t]/g, '')
  }
  return sPath.replace(/[.\s]+$/g, '').trim()
}

async function readOptions(cliOptions) {
  const defaultOptions = {
    out: 'manga',
    headless: true,
    userDataDir: 'data',
  }
  const path = cliOptions.config || 'config.json'
  if (!fs.existsSync(path)) {
    return Object.assign(defaultOptions, cliOptions)
  }
  const configStr = await fs.promises.readFile(path)
  const config = JSON.parse(configStr)
  return Object.assign(defaultOptions, cliOptions, config)
}