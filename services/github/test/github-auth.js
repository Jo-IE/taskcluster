const Debug = require('debug');
const sinon = require('sinon');
const _ = require('lodash');
const assert = require('assert');

class FakeGithub {
  constructor(installation_id) {
    this._installedOn = null;
    this._taskcluster_yml_files = {};
    this._org_membership = {};
    this._repo_collaborators = {};
    this._github_users = [];
    this._repo_info = {};
    this._repositories = {};
    this._statuses = {};
    this._comments = {};

    const throwError = code => {
      let err = new Error();
      err.status = code;
      err.code = code;
      throw err;
    };

    const stubs = {
      'repos.createStatus': ({owner, repo, sha, state, target_url, description, context}) => {
        if (repo === 'no-permission') {
          throwError(403);
        }
        const key = `${owner}/${repo}@${sha}`;
        const info = {
          state,
          target_url,
          description,
          context,
        };
        if (!this._statuses[key]) {
          this._statuses[key] = [];
        }
        this._statuses[key].push(info);
      },
      'issues.createComment': ({owner, repo, number, body}) => {
        if (repo === 'no-permission') {
          throwError(403);
        }
        const key = `${owner}/${repo}@${number}`;
        const info = {
          body,
        };
        if (!this._comments[key]) {
          this._comments[key]=[];
        }
        this._comments[key].push(info);
      },
      'repos.createCommitComment': () => {},
      'orgs.checkMembership': async ({org, username}) => {
        if (this._org_membership[org] && this._org_membership[org].has(username)) {
          return {};
        } else {
          throwError(404);
        }
      },
      'repos.checkCollaborator': async ({owner, repo, username}) => {
        const key = `${owner}/${repo}`;
        if (this._repo_collaborators[key] && this._repo_collaborators[key].has(username)) {
          return {};
        } else {
          throwError(404);
        }
      },
      'repos.get': async ({owner, repo}) => {
        const key = `${owner}/${repo}`;
        if (this._repo_info[key]) {
          return {data: this._repo_info[key]};
        } else {
          throwError(404);
        }
      },
      'repos.getContents': async ({owner, repo, path, ref}) => {
        assert.equal(path, '.taskcluster.yml');
        const key = `${owner}/${repo}@${ref}`;
        if (this._taskcluster_yml_files[key]) {
          return {data: {content: Buffer.from(
            JSON.stringify(this._taskcluster_yml_files[key]),
          ).toString('base64')}};
        } else {
          throwError(404);
        }
      },
      'users.getByUsername': async ({username}) => {
        let user = _.find(this._github_users, {username});
        if (user) {
          return {data: user};
        } else {
          throwError(404);
        }
      },
      'apps.listRepos': async () => {
        return {data: this._repositories};
      },
      'repos.listStatusesForRef': async ({owner, repo, ref}) => {
        const key = `${owner}/${repo}@${ref}`;
        const info = this._statuses[key];
        if (info && info.errorStatus) {
          throwError(info.errorStatus);
        }
        if (info) {
          return {data: info};
        } else {
          throwError(404);
        }
      },
      'checks.create': async ({owner, repo, name, head_sha, output, details_url, actions, status, conclusion}) => {
        if (repo === 'no-permission') {
          throwError(403);
        }

        const check_run_id = Math.floor(Math.random()*(9999-1000)) + 1000;

        return {
          data: {
            id: check_run_id,
            check_suite: {id: 5555},
          },
        };
      },
      'checks.update': async ({repo}) => {
        if (repo === 'no-permission') {
          throwError(403);
        }
        return {};
      },
    };

    const debug = Debug('FakeGithub');
    _.forEach(stubs, (implementation, name) => {
      let atoms = name.split(/\./);
      let obj = this; // eslint-disable-line consistent-this
      while (atoms.length > 1) {
        const atom = atoms.shift();
        if (!obj[atom]) {
          obj[atom] = {};
        }
        obj = obj[atom];
      }

      const atom = atoms.shift();
      obj[atom] = sinon.spy(async (options) => {
        debug(`inst(${installation_id}).${name}(${JSON.stringify(options)})`);
        return await (implementation || (() => {}))(options);
      });
    });
  }

  setTaskclusterYml({owner, repo, ref, content}) {
    const key = `${owner}/${repo}@${ref}`;
    this._taskcluster_yml_files[key] = content;
  }

  setOrgMember({org, member}) {
    if (!this._org_membership[org]) {
      this._org_membership[org] = new Set();
    }
    this._org_membership[org].add(member);
  }

  setRepoCollaborator({owner, repo, username}) {
    const key = `${owner}/${repo}`;
    if (!this._repo_collaborators[key]) {
      this._repo_collaborators[key] = new Set();
    }
    this._repo_collaborators[key].add(username);
  }

  setRepoInfo({owner, repo, info}) {
    const key = `${owner}/${repo}`;
    this._repo_info[key] = info;
  }

  setUser({id, email, username}) {
    assert(id, 'must provide id to setUser');
    assert(email, 'must provide email to setUser');
    assert(username, 'must provide username to setUser');
    this._github_users.push({id, email, username});
  }

  setRepositories(...repoNames) {
    // This function accepts 1 to n strings
    this._repositories.repositories = [...repoNames].map(repo => {return {name: repo};});
    this._repositories.total_count = this._repositories.repositories.length;
  }

  setStatuses({owner, repo, ref, info}) {
    const key = `${owner}/${repo}@${ref}`;
    this._statuses[key] = info;
  }

  listStatusesForRef({owner, repo, ref}) {
    const key = `${owner}/${repo}@${ref}`;
    return {data: this._statuses[key]};
  }

  getComments({owner, repo, number}) {
    const key = `${owner}/${repo}@${number}`;
    return {data: this._comments[key]};
  }

  hasNextPage() {
    return false;
  }
}

class FakeGithubAuth {
  constructor() {
    this.installations = {};
  }

  resetStubs() {
    this.installations = {};
  }

  async getInstallationGithub(installation_id) {
    return this.inst(installation_id);
  }

  // sync shorthand to getInstallationGithub for use in test scripts
  inst(installation_id) {
    if (!(installation_id in this.installations)) {
      this.installations[installation_id] = new FakeGithub(installation_id);
    }
    return this.installations[installation_id];
  }

  // For testing purposes, insert a new install
  createInstall(installation_id, owner, repos) {
    let installation = new FakeGithub(installation_id);
    installation._installedOn = owner;
    installation.setRepositories(...repos);
    this.installations[installation_id] = installation;
  }

  async getAppGithub() {
    return {
      apps: {
        getInstallations: async () => {
          return {data: _.map(this.installations, (install, id) => ({
            id: parseInt(id, 10),
            account: {login: install._installedOn},
          }))};
        },
      },
    };
  }
}

module.exports = () => new FakeGithubAuth();
