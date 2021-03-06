const logger = require('../utils/logger');
const GitHub = require('better-github-api');
const ordinal = require('ordinal');
const { URL } = require('url');

const getJobDisplayName = (job, index) => {
  if (job.config.language === 'node_js')
    return `Node.js: ${job.config.node_js}`;
  else if (job.config.language === 'ruby') return `Ruby: ${job.config.rvm}`;

  return `${ordinal(index + 1)} Build`;
};

const createJobObject = (job, index, owner, repoName, host) => ({
  id: job.id,
  displayName: getJobDisplayName(job, index),
  script: job.config.script,
  link: `https://${host}/${owner}/${repoName}/jobs/${job.id}`,
});

const getAllComments = async (githubToken, owner, repo, pullRequestNumber) => {
  if (!githubToken) {
    logger.warn('No Github token, cannot fetch comments');
    return [];
  }

  const gh = new GitHub({
    token: githubToken,
  });

  const issues = gh.getIssues(owner, repo);
  const comments = [];
  let page = 1;
  let bulk;

  do {
    try {
      bulk = await issues.listIssueComments(pullRequestNumber, {
        page,
      });
    } catch (e) {
      break;
    }

    comments.push(...bulk.data);

    page += 1;
  } while (bulk.data.length > 0);

  return comments;
};

const getPullRequestAuthor = async (
  githubToken,
  owner,
  repo,
  pullRequestNumber,
) =>
  new Promise((resolve, reject) => {
    if (!githubToken) {
      logger.warn('No GitHub token, unable to fetch PR owner');
      resolve('Unknown PR author');
    } else {
      const gh = new GitHub({
        token: githubToken,
      });

      gh
        .getRepo(owner, repo)
        .getPullRequest(pullRequestNumber, (err, pullRequest) => {
          if (err) return reject(err);
          return resolve(pullRequest.user.login);
        })
        .catch(() =>
          logger.warn(
            `Could not find author in: ${owner}/${repo} #${pullRequestNumber}`,
            {
              owner,
              repo,
              pullRequestNumber,
            },
          ),
        );
    }
  });

const parseTravisPayload = async ({ payload, meta, ...restOfContext }) => {
  const { host } = new URL(payload.build_url);

  return {
    owner: payload.repository.owner_name,
    repo: payload.repository.name,
    pullRequest: payload.pull_request_number,
    pullRequestTitle: payload.pull_request_title,
    buildNumber: payload.id,
    author: payload.author_name,
    state: payload.state,
    branch: payload.branch,
    travisType: payload.type,
    language: payload.config.language,
    scripts: payload.config.script,
    host,
    link: `https://${host}/${payload.repository.owner_name}/${
      payload.repository.name
    }/builds/${payload.id}`,

    payload,
    meta,
    ...restOfContext,

    jobs: payload.matrix
      .filter(job => job.state === 'failed')
      .map((job, index) =>
        createJobObject(
          job,
          index,
          payload.repository.owner_name,
          payload.repository.name,
          host,
        ),
      ),

    comments:
      (await getAllComments(
        meta.githubToken,
        payload.repository.owner_name,
        payload.repository.name,
        payload.pull_request_number,
      )) || [],

    pullRequestAuthor:
      (await getPullRequestAuthor(
        meta.githubToken,
        payload.repository.owner_name,
        payload.repository.name,
        payload.pull_request_number,
      )) || payload.author_name,
  };
};

module.exports = parseTravisPayload;
