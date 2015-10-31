var REDDIT_URL 		= "http://www.reddit.com/";
var REDDIT_API_URL 	= "http://api.reddit.com/";

// minimum of points for a submission for its comments to be considered
var SUBMISSION_THRESHOLD 		= 2;

// minimum of point for a comment to appear
var COMMENT_THRESHOLD 	 		= 4;

// maximum length of a comment to appear
var COMMENT_LENGTH_THRESHOLD 	= 350;

// max number of comments to retrieve per submission
var NB_RETRIEVED_COMMENTS		= 200;

// dont display comments from these bots
var blockedUsernames = ["xkcd_bot", "xkcdcomic_bot", "rss_feed"];

// only get comments from these subs
var typicalSubs = ["comics", "xkcd", "xkcdcomic", "funny"];

// slide in animation length
var slideIn = 25;
var transitionTime = 300;

var commentVerticalSpacing = 15;

var filledUp;
var previous;

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
			$(".xkcdr").remove();
		});
	}

	oldEnabled = enabled;
}

function main() {
	filledUp = 0;
	previous = 0;

	var container = $('<div id="container" />')
	$("body").prepend(container);

	filledUp = 0

	var url = window.location.href;

	// root page: find latest comic from "prev" link
	if(window.location.pathname == '/') {
		url = getHost() + ( $('a[rel=prev]').get(0).pathname.replace(/\//g,'')*1 +1) + "/";
		console.info('Index page! using ' + url);
	}

	$.ajax(REDDIT_API_URL + "submit.api?url=" + url, {
		success: function(t) {
			if(t.data) {
				// multiple submissions, load them all
				console.info(t.data.children.length + " submissions");

				$.each(t.data.children, function(i, result) {
					if(result.data.num_comments != 0) {
						var commentsUrl = result.data.permalink;
						loadComments(commentsUrl);

					} else {
						console.info('No comments.');
					}
				});

			} else if(t[0]) {
				// only one submission
				console.info("One submission: " + REDDIT_URL + t[0].data.children[0].data.permalink);

				displayComments(t[1].data.children, t[0].data.children[0].data.permalink);
			}

		}
	});
}

function loadComments(commentsUrl) {
	$.ajax(REDDIT_API_URL + commentsUrl + "?sort=top&limit=" + NB_RETRIEVED_COMMENTS, {
		success: function(c) {
			var submission 	= c[0].data.children[0].data
			var comments 	= c[1].data.children;

			var nbComments 	= submission.num_comments;
			var submissionScore = submission.ups - submission.downs;

			// TODO formatSubmission()?
			console.info(nbComments + ' comments, '+submissionScore+' points "'+submission.title+'" in "'+submission.subreddit+'" (' + REDDIT_URL + commentsUrl + ')');

			if(submissionScore >= SUBMISSION_THRESHOLD && inTypicalSub(submission)) {
				displayComments(comments, commentsUrl);
			}
		}
	});
}

function displayComments(comments, submissionUrl) {
	$.each(comments, function(i, comment) {
		//console.log(comment.data.body);

		if(worthy(comment) && !blockedUser(comment) && !deleted(comment) && filledUp!=2) {
			console.log('Comment kept!');

			var imgEl = $($('#comic').find($('img')));

			var anim;

			var offset = {};
			offset.top = imgEl.offset().top + previous - 55;

			if(filledUp == 0) {
				offset.left = -256 - slideIn + (782 - imgEl.width())/3;
				offset.left -= Math.sin( (previous/imgEl.height()) * Math.PI ) * 30;
				anim = { marginLeft: slideIn + "px" };

			} else {
				offset.left = 782 + slideIn - (782 - imgEl.width())/3;
				offset.left += Math.sin( (previous/imgEl.height()) * Math.PI ) * 30;
				anim = { marginLeft: (-1*slideIn) + "px" };
			}

			offset.left += (Math.random()-0.5) * 40;

			// comment <div> element
			var text = convert(comment.data.body_html);

			var commentDiv = $('<div class="box xkcdr" />')
				.css({'padding-left':2, 'padding-right':2, width: 250, position: 'absolute', 'z-index': 10, 'overflow': 'hidden'})
				.offset(offset)
				.html(text);

			var linkDiv = $('<small><a href="' + REDDIT_URL + submissionUrl + comment.data.id + '">'+comment.data.author+'</a></small>')
				.css({position: 'absolute', bottom: 3, right: 7})
				.hide()
				.prependTo(commentDiv);

			// add link to submitter on hover
			commentDiv.hover(function() {
				linkDiv.show();
			}, function() {
				linkDiv.hide();
			});

			// add and animate the comment
			commentDiv.animate(anim, {
				duration: transitionTime, 
				queue: false
			});

			commentDiv
				.hide()
				.prependTo("body")
				.fadeIn(transitionTime);

			previous += (commentDiv.height() + 1 + commentVerticalSpacing);

			// column overflow?
			if(previous > imgEl.height()) {
				previous = 0;
				filledUp++;

				if(filledUp > 2) {
					console.warn('Too many!');
				}
			}
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

	if(comment.data.ups - comment.data.downs < COMMENT_THRESHOLD) {
		return false;
	}

	return true;
}

function deleted(comment) {
	return (comment.data.body == '[deleted]');
}

function blockedUser(comment) {
	return ($.inArray(comment.data.author, blockedUsernames) != -1);
}

function inTypicalSub(submission) {
	return ($.inArray(submission.subreddit, typicalSubs) != -1);
}

var convert = function(convert){
	return $("<span />", { html: convert }).text();
};

function getHost() {
	return window.location.protocol + '//' + window.location.host +"/";
}