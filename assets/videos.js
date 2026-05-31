function videoEmbed(video) {
  if (!video?.id) return "";
  const title = video.title || "Federal Elections Analysis video";
  return `
    <div class="video-feature">
      <iframe src="https://www.youtube-nocookie.com/embed/${video.id}" title="${title.replace(/"/g, "&quot;")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
    </div>
    <p><a class="button-link" href="${video.url || `https://www.youtube.com/watch?v=${video.id}`}" target="_blank" rel="noreferrer">Watch on YouTube</a></p>
  `;
}

function videoCard(video) {
  const title = video.title || "Federal Elections Analysis upload";
  return `
    <article class="video-card">
      <iframe src="https://www.youtube-nocookie.com/embed/${video.id}" title="${title.replace(/"/g, "&quot;")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      <h3>${title}</h3>
      <a class="button-link" href="${video.url || `https://www.youtube.com/watch?v=${video.id}`}" target="_blank" rel="noreferrer">Watch on YouTube</a>
    </article>
  `;
}

async function renderVideos() {
  const upcoming = document.getElementById("upcoming-livestream");
  const latestLive = document.getElementById("latest-livestream");
  const uploads = document.getElementById("latest-uploads");
  if (!upcoming && !latestLive && !uploads) return;

  try {
    const response = await fetch("data/videos.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Video data returned ${response.status}`);
    const data = await response.json();
    const upcomingStream = data.upcomingLivestream?.status === "upcoming" ? data.upcomingLivestream : null;
    const latestReplay = data.latestLivestream?.status === "upcoming" ? null : data.latestLivestream;

    if (upcoming) {
      upcoming.innerHTML = upcomingStream
        ? videoEmbed(upcomingStream)
        : `<h2>No upcoming livestream announced.</h2><p>When the next public stream is scheduled, it will appear here automatically.</p>`;
    }
    if (latestLive) {
      latestLive.innerHTML = latestReplay
        ? videoEmbed(latestReplay)
        : `<p class="meta">No recent public livestream found.</p>`;
    }
    if (uploads) {
      uploads.innerHTML = (data.latestUploads || []).length
        ? data.latestUploads.slice(0, 4).map(videoCard).join("")
        : `<p class="meta">No public uploads found.</p>`;
    }
  } catch (error) {
    if (upcoming) upcoming.innerHTML = `<p class="meta">Video data unavailable.</p>`;
    if (latestLive) latestLive.innerHTML = `<p class="meta">Video data unavailable.</p>`;
    if (uploads) uploads.innerHTML = `<p class="meta">Video data unavailable.</p>`;
    console.error(error);
  }
}

renderVideos();
