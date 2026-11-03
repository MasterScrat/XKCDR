var REDDIT_URL 		= "https://www.reddit.com/";

// Reddit itself blocks API calls without app credentials, so comments come from
// Arctic Shift (https://github.com/ArthurHeitmann/arctic_shift), a free,
// volunteer-run archive of Reddit data. Keep the request count low.
var REDDIT_API_URL 	= "https://arctic-shift.photon-reddit.com/api/";

// minimum of points for a submission for its comments to be considered
var SUBMISSION_THRESHOLD 		= 2;

// minimum of point for a comment to appear
var COMMENT_THRESHOLD 	 		= 4;

// maximum length of a comment to appear
var COMMENT_LENGTH_THRESHOLD 	= 350;

// max number of comments to retrieve per submission
var NB_RETRIEVED_COMMENTS		= 200;

// dont display comments from these bots
var blockedUsernames = ["xkcd_bot", "xkcdcomic_bot", "rss_feed", "AutoModerator"];

// only get comments from these subs
var typicalSubs = ["comics", "xkcd", "xkcdcomic", "funny"];

// slide in animation length
var slideIn = 25;
var transitionTime = 300;

var commentVerticalSpacing = 15;

// column width, and the narrowest a column may get in a small window
var COLUMN_WIDTH = 250;
var MIN_COLUMN_WIDTH = 160;

// how far columns overlap the comic's white box
var BOX_OVERLAP = 7;

// horizontal padding + borders of a comment box, on top of its width
var BOX_CHROME = 7;

// keep comments at least this far from the window edges
var PAGE_MARGIN = 8;

// all comments for this comic, best first, once loaded
var allComments;
var loading = false;

var oldEnabled = false;

function setEnable(enabled) {
	if(oldEnabled == enabled) {
		// nothing to do
		return;
	}

	if(enabled) {
		main();

	} else {
		$(".xkcdr").fadeOut(transitionTime, function(){
			$(this).remove();
		});
	}

	oldEnabled = enabled;
}

function main() {
	if(allComments) {
		displayComments(allComments);
		return;
	}
	if(loading) {
		return;
	}

	var url = window.location.href;

	// root page: find latest comic from "prev" link
	if(window.location.pathname == '/') {
		url = getHost() + ( $('a[rel=prev]').get(0).pathname.replace(/\//g,'')*1 +1) + "/";
		console.info('Index page! using ' + url);
	}

	var comicNum = new URL(url).pathname.replace(/\//g,'');
	if(!/^\d+$/.test(comicNum)) {
		// not a comic page
		return;
	}

	var imgUrl = $('#comic img').attr('src');
	loading = true;

	findSubmissions(urlQueries(comicNum, imgUrl), [], function(submissions) {
		submissions = $.grep(submissions, function(s) {
			return isComicUrl(s.url, comicNum, imgUrl);
		});
		console.info(submissions.length + " submissions");

		var relevant = [];
		$.each(submissions, function(i, submission) {
			if(submission.num_comments == 0) {
				console.info('No comments.');

			} else if(submission.score >= SUBMISSION_THRESHOLD && inTypicalSub(submission)) {
				relevant.push(submission);
			}
		});

		loadComments(relevant, [], function(comments) {
			comments.sort(function(a, b) { return b.data.score - a.data.score; });
			allComments = comments;

			if(oldEnabled) {
				displayComments(allComments);
			}
		});
	});
}

// Arctic Shift requests go through the background worker, which caches them
function apiGet(path, params, success) {
	chrome.runtime.sendMessage({type: "get", url: REDDIT_API_URL + path + "?" + $.param(params)}, function(response) {
		if(!response || response.error) {
			console.warn("XKCD+R: couldn't load Reddit comments.", response && response.error);
			success(null);
			return;
		}
		success(response.data);
	});
}

// URL search is a prefix match, so these also catch "?…" and "#…" suffixes.
// Results are filtered back to this exact comic with isComicUrl().
function urlQueries(comicNum, imgUrl) {
	var queries = ["https://xkcd.com/" + comicNum + "/", "http://xkcd.com/" + comicNum + "/"];
	if(imgUrl) {
		var img = imgUrl.replace(/^https?:/, "");
		queries.push("https:" + img, "http:" + img);
	}
	return queries;
}

function isComicUrl(url, comicNum, imgUrl) {
	var img = imgUrl ? imgUrl.replace(/^https?:/, "") : null;
	return new RegExp("^https?://xkcd\\.com/" + comicNum + "/([?#].*)?$").test(url) ||
		(img && url.replace(/^https?:/, "").indexOf(img) == 0);
}

// one query at a time, to go easy on Arctic Shift
function findSubmissions(queries, found, done) {
	if(!queries.length) {
		done(found);
		return;
	}

	apiGet("posts/search", {url: queries[0], limit: 100, fields: "id,url,subreddit,score,num_comments"}, function(posts) {
		$.each(posts || [], function(i, post) {
			if(!$.grep(found, function(s) { return s.id == post.id; }).length) {
				found.push(post);
			}
		});
		findSubmissions(queries.slice(1), found, done);
	});
}

function loadComments(submissions, found, done) {
	if(!submissions.length) {
		done(found);
		return;
	}

	var submission = submissions[0];

	// top-level comments only; replies make little sense out of context
	apiGet("comments/tree", {link_id: submission.id, limit: NB_RETRIEVED_COMMENTS}, function(comments) {
		console.info((comments || []).length + ' comments, ' + submission.score + ' points in "' + submission.subreddit + '"');

		$.each(comments || [], function(i, comment) {
			if(comment.kind == "t1") {
				found.push(comment);
			}
		});
		loadComments(submissions.slice(1), found, done);
	});
}

function displayComments(comments) {
	var imgEl = $($('#comic').find($('img')));
	var boxEl = $('#middleContainer');
	if(!imgEl.length || !boxEl.length) {
		return;
	}

	// xkcd's <body> is a positioned, centered container, so absolute coordinates
	// are relative to it rather than to the page. Place everything inside a
	// zero-size container and measure from that container's own position instead.
	var container = $('#xkcdr-container');
	if(!container.length) {
		container = $('<div id="xkcdr-container" />')
			.css({position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible'})
			.appendTo("body");
	}
	var origin = container.get(0).getBoundingClientRect();
	var imgRect = imgEl.get(0).getBoundingClientRect();
	var boxRect = boxEl.get(0).getBoundingClientRect();
	var viewportWidth = document.documentElement.clientWidth;

	// columns hug the comic's white box, overlapping its edges, and move
	// inwards for narrow comics
	var inset = Math.max(0, (boxRect.width - imgRect.width)/3) + BOX_OVERLAP;
	var top = imgRect.top - origin.top - 55;
	var height = Math.max(imgRect.height, 300);

	// each column gets up to COLUMN_WIDTH, less if the window edge is closer;
	// a column with too little room is skipped
	var leftEdge = boxRect.left + inset;
	var rightEdge = boxRect.right - inset;
	var columns = $.grep([
		{side: -1, edge: leftEdge, width: Math.min(COLUMN_WIDTH, leftEdge - PAGE_MARGIN - BOX_CHROME), previous: 0},
		{side: 1, edge: rightEdge, width: Math.min(COLUMN_WIDTH, viewportWidth - rightEdge - PAGE_MARGIN - BOX_CHROME), previous: 0}
	], function(c) { return c.width >= MIN_COLUMN_WIDTH; });

	if(!columns.length) {
		console.info("XKCD+R: window too narrow to show comments next to the comic.");
		return;
	}

	$.each(comments, function(i, comment) {
		// alternate sides, so a handful of comments doesn't all end up on the left
		var open = $.grep(columns, function(c) { return !c.full; });
		if(!open.length) {
			return false;
		}
		var column = open[0];
		$.each(open, function(j, c) {
			if(c.previous < column.previous) column = c;
		});

		if(worthy(comment) && !blockedUser(comment) && !deleted(comment)) {
			// comment <div> element
			var commentDiv = $('<div class="box xkcdr" />')
				.css({'padding-left':2, 'padding-right':2, width: column.width, position: 'absolute', 'z-index': 10, 'overflow': 'hidden'})
				.append(renderBody(comment.data.body));

			var linkDiv = $('<small />')
				.append($('<a />', {href: permalink(comment), target: '_blank', rel: 'noopener', text: comment.data.author}))
				.css({position: 'absolute', bottom: 3, right: 7})
				.hide()
				.prependTo(commentDiv);

			// add link to submitter on hover
			commentDiv.hover(function() {
				linkDiv.show();
			}, function() {
				linkDiv.hide();
			});

			// measure before placing
			commentDiv.css('visibility', 'hidden').appendTo(container);
			var commentHeight = commentDiv.outerHeight();
			var commentWidth = commentDiv.outerWidth();

			// column overflow?
			if(column.previous > 0 && column.previous + commentHeight > height) {
				column.full = true;
				commentDiv.remove();
				return;
			}

			// drift away from the comic in a gentle arc, but never past the window edge
			var wobble = Math.sin( (column.previous/height) * Math.PI ) * 30 + (Math.random()-0.5) * 40;
			var left = column.side < 0
				? Math.max(PAGE_MARGIN, column.edge - commentWidth - wobble)
				: Math.min(viewportWidth - PAGE_MARGIN - commentWidth, column.edge + wobble);

			// add and animate the comment, sliding in towards the comic
			commentDiv
				.css({top: top + column.previous, left: left - origin.left + column.side * slideIn, visibility: ''})
				.animate({marginLeft: (-1 * column.side * slideIn) + "px"}, {
					duration: transitionTime,
					queue: false
				})
				.hide()
				.fadeIn(transitionTime);

			column.previous += commentHeight + commentVerticalSpacing;
		}

	});
}

function worthy(comment) {
	if(!comment.data.body) {
		// "more" link
		return false;
	}

	if(comment.data.body.length > COMMENT_LENGTH_THRESHOLD) {
		return false;
	}

	if(comment.data.score < COMMENT_THRESHOLD) {
		return false;
	}

	return true;
}

function deleted(comment) {
	return (comment.data.body == '[deleted]' || comment.data.body == '[removed]');
}

function blockedUser(comment) {
	return ($.inArray(comment.data.author, blockedUsernames) != -1);
}

function inTypicalSub(submission) {
	return ($.inArray(submission.subreddit.toLowerCase(), typicalSubs) != -1);
}

// archived permalinks are malformed for older threads; build our own
function permalink(comment) {
	return REDDIT_URL + "r/" + comment.data.subreddit + "/comments/" + comment.data.link_id.replace(/^t3_/, '') + "/_/" + comment.data.id + "/";
}

// Comment bodies are Reddit markdown with &, < and > entity-escaped. Render a
// small safe subset: paragraphs, quotes, links, bold and italics. Everything
// else stays plain text; nothing is ever parsed as HTML.
var convert = function(convert){
	return convert.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
};

function safeUrl(href) {
	try {
		var url = new URL(href, REDDIT_URL);
		return (url.protocol == "https:" || url.protocol == "http:") ? url.href : null;
	} catch(e) {
		return null;
	}
}

var INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

function renderInline(parent, text) {
	var last = 0;
	var m;
	INLINE.lastIndex = 0;
	while((m = INLINE.exec(text))) {
		parent.append(document.createTextNode(text.slice(last, m.index)));
		var href = m[1] ? safeUrl(m[2]) : m[3] ? safeUrl(m[3]) : null;
		if(href) {
			parent.append($('<a />', {href: href, target: '_blank', rel: 'noopener', text: m[1] || m[3]}));
		} else if(m[4] || m[5]) {
			parent.append($(m[4] ? '<strong />' : '<em />', {text: m[4] || m[5]}));
		} else {
			parent.append(document.createTextNode(m[0]));
		}
		last = INLINE.lastIndex;
	}
	parent.append(document.createTextNode(text.slice(last)));
}

function renderBody(body) {
	var blocks = [];
	$.each(convert(body).split(/\n\s*\n/), function(i, block) {
		block = $.trim(block);
		if(!block) return;

		var quote = /^>/.test(block);
		var el = quote
			? $('<blockquote />').css({margin: '0.4em 0', 'padding-left': 6, 'border-left': '2px solid #ccc', color: '#555'})
			: $('<p />');
		renderInline(el, quote ? block.replace(/^>\s?/gm, "") : block);
		blocks.push(el);
	});
	return blocks;
}

function getHost() {
	return window.location.protocol + '//' + window.location.host +"/";
}

// the toolbar icon toggles this in storage, for every xkcd tab at once
chrome.storage.sync.get('disabled', function(disabled) {
	setEnable(!disabled.disabled);
});

chrome.storage.onChanged.addListener(function(changes, area) {
	if(area == "sync" && changes.disabled) {
		setEnable(!changes.disabled.newValue);
	}
});

// columns depend on the window width, so lay comments out again on resize
// (plain DOM: this runs before jQuery is loaded)
var resizeTimer;
window.addEventListener("resize", function() {
	clearTimeout(resizeTimer);
	resizeTimer = setTimeout(function() {
		if(!oldEnabled || !allComments) return;
		$(".xkcdr").remove();
		displayComments(allComments);
	}, 200);
});
