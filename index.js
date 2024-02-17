const fs = require('fs')
const core = require('@actions/core')
const github = require('@actions/github')
const context = github.context

async function main() {
  const n = parseInt(core.getInput('n'))
  if (n < 1) {
    throw new Error(`input n should be >= 1 (was ${n})`)
  }

  const dryRun = core.getInput('dry_run') === 'true'
  const lastTagFile = core.getInput('last_tag_file')
  const removeTagsWithoutRelease = core.getInput('remove_tags_without_release') === 'true'

  const octokit = github.getOctokit(process.env.GITHUB_TOKEN).rest
  const { owner, repo } = context.repo

  async function cleanupReleases(releases, kind) {
    core.startGroup(`${kind} Releases`)

    // Sort by older to newest
    releases.sort((a, b) => Date.parse(releaseDate(a)) <= Date.parse(releaseDate(b)) ? -1 : 1)

    console.log(`All ${releases.length} ${kind} releases (oldest to newest):`)
    for (const release of releases) {
      console.log(formatRelease(release))
    }

    let toDelete
    if (releases.length <= n) {
      console.log(`Only ${releases.length} ${kind} releases left (<= n=${n}), not deleting any`)
      toDelete = []
    } else {
      toDelete = releases.slice(0, releases.length - n)
    }

    if (lastTagFile !== '') {
      const lastTag = fs.readFileSync(lastTagFile, 'utf8').trim()
      console.log(`Keeping release with tag ${lastTag}`)
      toDelete = toDelete.filter(release => release.tag_name !== lastTag)
    }

    console.log(`Kept ${kind} releases:`)
    for (const release of releases.filter(release => !toDelete.includes(release))) {
      console.log(formatRelease(release))
    }

    console.log(`${toDelete.length} ${kind} releases to be deleted:`)
    for (const release of toDelete) {
      if (dryRun) {
        console.log(`Would delete ${formatRelease(release)}`)
      } else {
        console.log(`\nDeleting ${formatRelease(release)}`)
        await octokit.repos.deleteRelease({ owner, repo, release_id: release.id })

        const tag = release.tag_name
        console.log(`Deleting tag ${tag}`)
        await deleteTag(tag)
      }
    }
    core.endGroup()
  }

  async function cleanupTags(releases) {
    core.startGroup('Removing tags without an associated release')

    let { data: tags } = await octokit.repos.listTags({ owner, repo })
    tags = tags.map(tag => tag.name)
    console.log(`All tags: ${tags.join(', ')}`)

    const releaseTags = new Set(releases.map(release => release.tag_name))
    console.log(`All tags with a release: ${Array.from(releaseTags).join(', ')}`)

    const toDelete = tags.filter(tag => !releaseTags.has(tag))

    console.log(`${toDelete.length} tags to be deleted:`)
    for (const tag of toDelete) {
      if (dryRun) {
        console.log(`Would delete ${tag}`)
      } else {
        console.log(`Deleting tag ${tag}`)
        await deleteTag(tag)
      }
    }
    core.endGroup()
  }

  async function deleteTag(tag) {
    const ref = `tags/${tag}`
    try {
      await octokit.git.deleteRef({ owner, repo, ref })
    } catch (e) {
      console.log(`Tag ${tag} does not exist: ${e.message}`)
    }
  }

  let { data: releases } = await octokit.repos.listReleases({ owner, repo })

  const draftReleases = releases.filter(release => release.draft)
  const fullReleases = releases.filter(release => !release.draft)

  await cleanupReleases(fullReleases, "Full")
  await cleanupReleases(draftReleases, "Draft")

  if (removeTagsWithoutRelease) {
    await cleanupTags(releases)
  }
}

function releaseDate(release) {
  return release.draft ? release.created_at : release.published_at
}

function formatRelease(release) {
  if (release.draft) {
    return `Release created at ${release.created_at}, tag: ${release.tag_name}`
  } else {
    return `Release published at ${release.published_at}, tag: ${release.tag_name}`
  }
}

async function run() {
  try {
    await main()
  } catch (error) {
    core.setFailed(error.stack)
  }
  // Explicit process.exit() to not wait hanging promises,
  // see https://github.com/ruby/setup-ruby/issues/543
  process.exit()
}

run()
