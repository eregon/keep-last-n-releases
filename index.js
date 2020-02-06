const fs = require('fs')
const core = require('@actions/core')
const { GitHub, context } = require('@actions/github')

async function main() {
  const n = parseInt(core.getInput('n'))
  if (n < 1) {
    throw new Error(`input n should be >= 1 (was ${n})`)
  }

  const dryRun = core.getInput('dry_run') === 'true'

  const lastTagFile = core.getInput('last_tag_file')

  const github = new GitHub(process.env.GITHUB_TOKEN)
  const { owner, repo } = context.repo

  let { data: releases } = await github.repos.listReleases({ owner, repo })

  // Ignore draft releases
  releases = releases.filter(release => !release.draft)

  // Sort by older to newest
  releases.sort((a, b) => Date.parse(a.published_at) <= Date.parse(b.published_at) ? -1 : 1)

  console.log(`All ${releases.length} releases (oldest to newest):`)
  for (const release of releases) {
    console.log(formatRelease(release))
  }

  let toDelete
  if (releases.length <= n) {
    console.log(`Only ${releases.length} releases left (<= n=${n}), not deleting any`)
    toDelete = []
  } else {
    toDelete = releases.slice(0, releases.length - n)
  }

  if (lastTagFile !== '') {
    const lastTag = fs.readFileSync(lastTagFile, 'utf8').trim()
    console.log(`Keeping release with tag ${lastTag}`)
    toDelete = toDelete.filter(release => release.tag_name !== lastTag)
  }

  console.log('Kept releases:')
  for (const release of releases.filter(release => !toDelete.includes(release))) {
    console.log(formatRelease(release))
  }

  console.log(`${toDelete.length} releases to be deleted:`)
  for (const release of toDelete) {
    if (dryRun) {
      console.log(`Would delete ${formatRelease(release)}`)
    } else {
      console.log(`Deleting ${formatRelease(release)}`)
      await github.repos.deleteRelease({ owner, repo, release_id: release.id })

      const tag = release.tag_name
      console.log(`Deleting tag ${tag}`)
      await github.git.deleteRef({ owner, repo, ref: `tags/${tag}` })
    }
  }

  console.log('Done')
}

function formatRelease(release) {
  return `Release published at ${release.published_at}, tag: ${release.tag_name}`
}

async function run() {
  try {
    await main()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
