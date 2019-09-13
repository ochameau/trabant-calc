const searchParams = new URLSearchParams(window.location.search);

async function fetchJSON(url) {
  const response = await fetch(url);
  const json = await response.json();
  return json;
}

async function fetchPushJobs(branch, push_id) {
  let durations = [];
  let job_property_names;
  let offset = 0;

  while (true) {
    const URL = `https://treeherder.mozilla.org/api/project/${branch}/jobs/?push_id=${push_id}&count=2000&return_type=list&offset=${offset}`;
    const json2 = await fetchJSON(URL); 
    durations = durations.concat(json2.results);
    job_property_names = json2.job_property_names;
    if (json2.results < 2000) {
      break;
    }
    offset += 2000;
  }

  const endIdx = job_property_names.indexOf("end_timestamp");
  const startIdx = job_property_names.indexOf("start_timestamp");
  const jobTypeIdx = job_property_names.indexOf("job_type_name");

  durations = durations.map(list => {
    return {
      description: list[jobTypeIdx],
      duration: ((list[endIdx] && list[startIdx]) ? (list[endIdx] - list[startIdx]) : 0),
    };
  }).filter(({duration}) => duration > 0);

  return durations;
}

async function loadTryEmail(email, count) {
  const url = `https://treeherder.mozilla.org/api/project/try/push/?full=true&count=${count}&author=${encodeURIComponent(email)}`;
  const json = await fetchJSON(url);
  await loadResults("try", json.results);
}

async function loadBranch(branch, count) {
  const url = `https://treeherder.mozilla.org/api/project/${branch}/push/?full=true&count=${count}`;
  const json = await fetchJSON(url);
  await loadResults(branch, json.results);
}

async function loadChangeset(branch, changeset, count) {
  const url = `https://treeherder.mozilla.org/api/project/${branch}/push/?full=true&count=${count}&revision=${changeset}`;
  const json = await fetchJSON(url);
  await loadResults(branch, json.results);
}

async function loadResults(branch, revisionList) {
  const changesetInfos = [];
  let maxDuration = 0;
  for (const revision of revisionList) {
    const { id, revisions } = revision;

    const comments = revisions.map(({comments}) => {
      const m = comments.match(/^(\s*bug.*r=\w+)/i);
      if (m) return m[1];
      return comments;
    }).filter(m=>!!m).join("<br />");

    let allDurations = await fetchPushJobs(branch, id);
    let durations = allDurations;

    const filters = [];//"linux", "devtools-chrome-e10s"];
    const sort = "duration";

    if (filters) {
      durations = durations.filter(({description}) => {
        return filters.every(filter => description.includes(filter));
      });
    }

    if (sort == "description") {
      durations.sort((a,b) => a.description > b.description);
    } else if (sort == "duration") {
      durations.sort((a,b) => a.duration > b.duration);
    }
    if (durations.length == 0) continue;

    let totalDuration = 0;
    for (const { duration } of durations) {
      totalDuration += duration;
    }
    let totalDurationAll = 0;
    for (const { duration } of allDurations) {
      totalDurationAll += duration;
    }
    maxDuration = Math.max(totalDurationAll, maxDuration);

    changesetInfos.push({ revision: revision.revision, durations, allDurations, comments, totalDuration, totalDurationAll });
  }

  const results = document.querySelector("#results");

  for (const { revision, durations, allDurations, comments, totalDuration, totalDurationAll } of changesetInfos) {
    const ratio = totalDurationAll / maxDuration;
    const dotElt = document.createElement("div");
    dotElt.className = "dot";
    dotElt.style.width = dotElt.style.height = Math.round(ratio * 50) + "px";
    results.appendChild(dotElt);

    const kmElt = document.createElement("div");
    kmElt.className = "km";
    const hours = Math.floor(totalDuration / 3600);
    const kmPerHours = 0.4387058823529412;
    const km = Math.round(hours * kmPerHours);
    kmElt.style.filter = "grayscale(" + (100 - Math.round(ratio * 100)) + "%)";
    kmElt.textContent = km + "km";
    results.appendChild(kmElt);

    const link = `https://treeherder.mozilla.org/#/jobs?repo=${branch}&revision=${revision}`;
    const durationElt = document.createElement("div");
    durationElt.innerHTML = prettyPrintDuration(totalDurationAll) +
      ` <span style="color: gray">(${allDurations.length} jobs)</span>` + 
      ` (<a href="${link}" target="_blank">treeherder</a>)`;


    //"<b>filtered: => "+ prettyPrintDuration(totalDuration) + " </b> # jobs: " + durations.length + "<br/>"
    results.appendChild(durationElt);

    const changesetElt = document.createElement("div");
    changesetElt.innerHTML = comments;
    results.appendChild(changesetElt);

    if (searchParams.has("details")) {
      const durationHTML = durations.map(({ description, duration}) => {
        return "<li>" + description + " = " + prettyPrintDuration(duration) + "</li>";
      }).join("");
      const durationDetailsElt = document.createElement("ul");
      durationDetailsElt.innerHTML = durationHTML;
      changesetElt.appendChild(durationDetailsElt);
    }
  }
}

function prettyPrintDuration(seconds) {
  const months = Math.floor(seconds / (3600 * 24 * 30));
  seconds -= months * 3600 * 24 * 30;
  const days = Math.floor(seconds / (3600 * 24));
  seconds -= days * 3600 * 24;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  let str = [];
  if (months) {
    str.push(months + "month" + (months > 1 ? "s" : ""));
  }
  if (days) {
    str.push(days + "day" + (days > 1 ? "s": ""));
  }
  if (hours) {
    str.push(hours + "h");
  }
  if (minutes) {
    str.push(minutes + "m");
  }
  if (seconds) {
    str.push(seconds + "s");
  }
  return str.join(" ")
}

async function update() {
  const searchType = searchParams.get("search-type") || "try";
  for (const header of document.querySelectorAll("h2[data-search-type]")) {
    header.hidden = header.dataset.searchType != searchType;
  }
  for (const link of document.querySelectorAll("h2 a[data-search-type]")) {
    link.className = link.dataset.searchType == searchType ? "selected" : "";
  }

  const email = searchParams.get("email");
  const changeset = searchParams.get("changeset");
  const branch = searchParams.get("branch");

  const emailForm = document.getElementById("email");
  emailForm.value = email;

  const detailsForm = document.getElementById("details");
  detailsForm.checked = searchParams.has("details");

  const branchForm = document.getElementById("branch");
  branchForm.value = searchParams.get("branch");

  const changesetForm = document.getElementById("changeset");
  changesetForm.value = searchParams.get("changeset");

  const url = window.location.origin + window.location.pathname + "?" + searchParams.toString();
  if (url != window.location.href) {
    window.history.replaceState(null, document.title, url);
  }

  const what = document.getElementById("what");
  if (email || branch) {
    const count = searchParams.get("count") || 10;
    const resultsDiv = document.getElementById("results");
    resultsDiv.classList.add("loading");
    resultsDiv.innerHTML = "";
    what.hidden = true;
    if (email) {
      await loadTryEmail(email, count);
    } else if (branch && changeset) {
      await loadChangeset(branch, changeset, count);
    } else if (branch) {
      await loadBranch(branch, count);
    }
    resultsDiv.classList.remove("loading");
  } else {
    what.hidden = false;
  }
};

function onLoad() {
  const emailForm = document.getElementById("email");
  emailForm.addEventListener("keypress", event => {
    if (event.key == "Enter") {
      searchParams.set("email", emailForm.value);
      update();
    }
  });

  const changesetForm = document.getElementById("changeset");
  changesetForm.addEventListener("keypress", event => {
    if (event.key == "Enter") {
      searchParams.set("changeset", changesetForm.value);
      update();
    }
  });

  const branchForm = document.getElementById("branch");
  branchForm.addEventListener("change", event => {
    searchParams.set("branch", branchForm.value);
    update();
  });

  const detailsForm = document.getElementById("details");
  detailsForm.addEventListener("click", event => {
    if (detailsForm.checked) {
      searchParams.set("details", "true");
    } else {
      searchParams.delete("details");
    }
    update();
  });

  update();
}
window.addEventListener("load", onLoad, {once: true});
