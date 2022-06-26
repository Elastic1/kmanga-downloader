const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const PUPPETEER_REVISIONS = require('puppeteer/lib/cjs/puppeteer/revisions.js').PUPPETEER_REVISIONS
function win32(canary) {
  const suffix = canary ?
    `${path.sep}Google${path.sep}Chrome SxS${path.sep}Application${path.sep}chrome.exe` :
    `${path.sep}Google${path.sep}Chrome${path.sep}Application${path.sep}chrome.exe`
  const suffixEdge = `${path.sep}Microsoft${path.sep}Edge${path.sep}Application${path.sep}msedge.exe`
  const prefixes = [
    process.env.LOCALAPPDATA,
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)']
  ].filter(Boolean)

  for (const prefix of prefixes) {
    const chromePath = path.join(prefix, suffix)
    const edgePath = path.join(prefix, suffixEdge)
    if (canAccess(chromePath)) {
      return chromePath
    } else if (canAccess(edgePath)) {
      return edgePath
    }
  }
  return null
}

function canAccess(file) {
  if (!file)
    return false

  try {
    fs.accessSync(file)
    return true
  } catch (e) {
    return false
  }
}

async function downloadChromium(options, targetRevision) {
  const browserFetcher = puppeteer.createBrowserFetcher({ path: options.localDataDir })
  const revision = targetRevision || PUPPETEER_REVISIONS.chromium
  const revisionInfo = browserFetcher.revisionInfo(revision)

  if (revisionInfo.local)
    return revisionInfo

  try {
    const newRevisionInfo = await browserFetcher.download('1002410', (size, totalSize) => {
      process.stdout.write(`\r Downloading chromium... ${Math.round(size / 1024 / 1024)}MB/${Math.round(totalSize / 1024 / 1024)}MB`)
      if (size == totalSize) {
        process.stdout.write('\n')
      }
    })
    console.log('Chromium downloaded to ' + newRevisionInfo.folderPath)
    let localRevisions = await browserFetcher.localRevisions()
    localRevisions = localRevisions.filter(revision => revision !== revisionInfo.revision)
    const cleanupOldVersions = localRevisions.map(revision => browserFetcher.remove(revision))
    await Promise.all(cleanupOldVersions)
    return newRevisionInfo
  } catch (error) {
    console.error(`ERROR: Failed to download Chromium r${revision}!`)
    console.error(error)
    return null
  }
}

async function findChrome(options = {}) {
  if (options.executablePath)
    return { executablePath: options.executablePath, type: 'user' }

  const config = new Set(options.channel || ['stable'])
  let executablePath
  if (config.has('canary') || config.has('*')) {
    if (process.platform === 'win32')
      executablePath = win32(true)
    if (executablePath)
      return { executablePath, type: 'canary' }
  }

  if (config.has('stable') || config.has('*')) {
    if (process.platform === 'win32')
      executablePath = win32()
    if (executablePath)
      return { executablePath, type: 'stable' }
  }

  if (config.has('chromium') || config.has('*')) {
    const revisionInfo = await downloadChromium(options)
    return { executablePath: revisionInfo.executablePath, type: revisionInfo.revision }
  }

  for (const item of config) {
    if (!item.startsWith('r'))
      continue
    const revisionInfo = await downloadChromium(options, item.substring(1))
    return { executablePath: revisionInfo.executablePath, type: revisionInfo.revision }
  }

  return {}
}

module.exports = findChrome