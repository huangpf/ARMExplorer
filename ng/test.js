﻿angular.module("managePortal", ["ngRoute", "ngAnimate", "ngSanitize", "ui.bootstrap", "angularBootstrapNavTree", "rx"])
    .controller("bodyController", function ($scope, $routeParams, $location, $http, $q, $timeout, rx) {

        $scope.jsonHtml = "select something";
        $scope.treeControl = {};
        $scope.resourcesUrlsTable = [];
        $scope.resources = [];
        var editor;
        $timeout(function () {
            editor = new JSONEditor(document.getElementById("jsoneditor"));
        });

        $scope.$createObservableFunction("selectResourceHandler")
            .flatMapLatest(selectResource)
            .subscribe(function (value) {
                $scope.invoking = false;
                $scope.loading = false;
                if (value.data === undefined) {
                    editor.set({});
                    $scope.show = false;
                    $scope.selectedResource = { label: value.resourceName };
                    $scope.jsonHtml = "No GET Url"
                    return;
                }
                var data = value.data;
                var resourceUrl = value.resourceUrl;
                var url = value.url;
                var resource = value.resource;
                $scope.jsonHtml = syntaxHighlight(data);
                $scope.rawData = data;
                var putActions = resourceUrl.actions.filter(function (a) { return (a === "Post" || a === "Put"); });
                if (putActions.length === 1) {
                    var editable = jQuery.extend(true, {}, resourceUrl.requestBody);
                    mergeObject($scope.rawData, editable);
                    editor.set(editable);
                    $scope.show = true;
                    editor.expandAll();
                    if (url.endsWith("list")) {
                        url = url.substring(0, url.lastIndexOf("/"));
                    }
                } else {
                    editor.set({});
                    $scope.show = false;
                }
                $scope.putUrl = url;
                resource.actions = resourceUrl.actions.filter(function (a) { return (a !== "Put" && a !== "Get" && a !== "GetPost"); });
                $scope.selectedResource = resource;
            });

        $scope.invokeMethod = function () {
            var userObject = editor.get();
            cleanObject(userObject);
            $scope.invoking = true;
            $http({
                method: "POST",
                url: "api/operations",
                data: {
                    Url: $scope.putUrl,
                    HttpMethod: "Put",
                    RequestBody: userObject
                }
            }).finally(function () {
                $scope.selectResourceHandler($scope.selectedResource).finally(function () {
                    $scope.invoking = false;
                    $("html, body").scrollTop(0);
                });
            });
        };

        $scope.expandResourceHandler = function (branch, row, event) {
            if (branch.is_leaf) return;
            if (branch.expanded) {
                // clear the children array on collapse
                branch.children.length = 0;
                $scope.treeControl.collapse_branch(branch);
                return;
            }

            var resourceUrls = $scope.resourcesUrlsTable.filter(function (r) {
                return (r.resourceName === branch.resourceName) && ((r.url === branch.resourceUrl) || r.url === (branch.resourceUrl + "/" + branch.resourceName));
            });
            if (resourceUrls.length > 1) {
                console.log("ASSERT! More than 1 resourceUrl. This is an error");
                return;
            }
            if (resourceUrls.length !== 1) return;
            var resourceUrl = resourceUrls[0];

            if (Array.isArray(resourceUrl.children)) {
                //TODO
                branch.children = resourceUrl.children.map(function (c) {
                    var child = $scope.resourcesUrlsTable.filter(function (r) {
                        return (r.resourceName === c) && ((r.url === resourceUrl.url) || r.url === (resourceUrl.url + "/" + c));
                    });
                    return {
                        label: c,
                        resourceName: c,
                        resourceUrl: resourceUrl.url,
                        is_leaf: (child.length > 0 && child[0].children ? false : true)
                    };
                });
            } else if (typeof resourceUrl.children === "string") {
                var childUrl = injectTemplateValues(resourceUrl.url, branch);

                var originalTreeIcon = row.tree_icon;
                $(event.target).removeClass(originalTreeIcon).addClass("fa fa-refresh fa-spin");
                var httpConfig = (childUrl.endsWith("resourceGroups") || childUrl.endsWith("subscriptions") || childUrl.split("/").length === 3)
                  ? {
                      method: "GET",
                      url: "api" + childUrl.substring(childUrl.indexOf("/subscriptions")),
                  }
                  : {
                      method: "POST",
                      url: "api/operations",
                      data: {
                          Url: childUrl,
                          HttpMethod: "Get"
                      }
                  };
                return $http(httpConfig).success(function (data) {
                    branch.children = (data.value ? data.value : data).map(function (d) {
                        var child = $scope.resourcesUrlsTable.filter(function (r) {
                            return (r.resourceName === resourceUrl.children) && ((r.url === resourceUrl.url) || r.url === (resourceUrl.url + "/" + resourceUrl.children));
                        });
                        return {
                            label: (d.displayName ? d.displayName : d.name),
                            resourceName: resourceUrl.children,
                            resourceUrl: resourceUrl.url,
                            value: (d.subscriptionId ? d.subscriptionId : d.name),
                            is_leaf: (child.length > 0  && child[0].children ? false : true)
                        };
                    });
                }).finally(function () {
                    $(event.target).removeClass("fa fa-spinner fa-spin").addClass(originalTreeIcon);
                    $scope.treeControl.expand_branch(branch);
                });
            } //else if undefined
            $scope.treeControl.expand_branch(branch);
        };

        $http({
            method: "GET",
            url: "api/operations"
        }).success(function (operations) {
            operations.sort(function (a, b) {
                return a.Url.localeCompare(b.Url);
            });
            operations.map(function (operation) {
                //TODO: remove this
                operation = fixOperationUrl(operation);

                addToResourceUrlTable(operation);
                $scope.resourcesUrlsTable.map(function (r) {
                    if (Array.isArray(r.children)) {
                        r.children.sort()
                    }
                });
            });
            $scope.resources = $scope.resourcesUrlsTable.map(function (r) { return r.url.split("/"); }).filter(function (a) { return a.length > 3; }).map(function (a) {
                return { resourceName: a[3], resourceUrl: a.slice(0, 4).join("/") };
            }).getUnique(function (d) { return d.resourceName; }).map(function (s) {
                return {
                    label: s.resourceName,
                    resourceName: s.resourceName,
                    resourceUrl: s.resourceUrl,
                    data: undefined,
                    resource_icon: "fa fa-cube fa-fw",
                    children: []
                };
            });
        });

        function fixOperationUrl(operation) {
            if (operation.Url.indexOf("SourceControls/{name}") !== -1) {
                operation.Url = operation.Url.replace("SourceControls/{name}", "SourceControls/{sourceControlName}");
            }
            if (operation.Url.indexOf("serverFarms/{name}") !== -1) {
                operation.Url = operation.Url.replace("serverFarms/{name}", "serverFarms/{webHostingPlanName}");
            }
            if (operation.Url.indexOf("resourcegroups") !== -1) {
                operation.Url = operation.Url.replace("resourcegroups", "resourceGroups");
            }
            if (operation.Url.endsWith("/")) {
                operation.Url = operation.Url.substring(0, operation.Url.length - 1);
            }
            return operation;
        }

        function addToResourceUrlTable(operation, url) {
            url = (operation ? operation.Url : url);
            var segments = url.split("/").filter(function (a) { return a.length !== 0 });
            var resourceName = segments.pop();
            var addedElement;

            if (resourceName === "list" && operation && operation.HttpMethod === "Post") {
                setParent(url, "GetPost");
                return;
            }

            //set the element itself
            var elements = $scope.resourcesUrlsTable.filter(function (r) { return r.url === url });
            if (elements.length === 1) {
                //it's there, update it's actions
                if (operation) {
                    elements[0].requestBody = (elements[0].requestBody ? elements[0].requestBody : operation.RequestBody);
                    if (elements[0].actions.filter(function (c) { return c === operation.HttpMethod }).length === 0) {
                        elements[0].actions.push(operation.HttpMethod);
                    }
                }
            } else {
                addedElement = {
                    resourceName: resourceName,
                    children: undefined,
                    actions: (operation ? [operation.HttpMethod] : []),
                    url: url,
                    requestBody: operation ? operation.RequestBody : {}
                };
                $scope.resourcesUrlsTable.push(addedElement);
            }

            // set the parent recursively
            setParent(url);
            return addedElement;
        }

        function setParent(url, action) {
            var segments = url.split("/").filter(function (a) { return a.length !== 0; });
            var resourceName = segments.pop();
            var parentName = url.substring(0, url.lastIndexOf("/"));//segments.pop();
            if (parentName === undefined || parentName === "" || resourceName === undefined) return;
            var parents = $scope.resourcesUrlsTable.filter(function (r) { return r.url === parentName; });
            var parent;
            if (parents.length === 1) {
                parent = parents[0];
                if (resourceName.match(/\{.*\}/g)) {
                    // this means the parent.children should either be an undefined, or a string.
                    // if it's anything else assert! because that means we have a mistake in out assumptions
                    if (parent.children === undefined || typeof parent.children === "string") {
                        parent.children = resourceName;
                    } else {
                        console.log("ASSERT, typeof parent.children: " + typeof parent.children)
                    }
                } else if (resourceName !== "list") {
                    // this means that the resource is a pre-defined one. the parent.children should be undefined or array
                    // if it's anything else assert! because that means we have a mistake in out assumptions
                    if (parent.children === undefined) {
                        parent.children = [resourceName];
                    } else if (Array.isArray(parent.children)) {
                        if (parent.children.filter(function (c) { return c === resourceName; }).length === 0) {
                            parent.children.push(resourceName);
                        }
                    } else {
                        console.log("ASSERT, typeof parent.children: " + typeof parent.children)
                    }
                }
            } else {
                //this means the parent is not in the array. Add it
                parent = addToResourceUrlTable(undefined, url.substring(0, url.lastIndexOf("/")));
                setParent(url);
            }
            if (action && parent && parent.actions.filter(function (c) { return c === action; }).length === 0) {
                parent.actions.push(action);
            }
        }

        function injectTemplateValues(url, branch) {
            var resourceParent = branch;
            while (resourceParent !== undefined) {
                if (resourceParent.value !== undefined) {
                    url = url.replace(resourceParent.resourceName, resourceParent.value);
                }
                resourceParent = $scope.treeControl.get_parent_branch(resourceParent);
            }
            return url;
        }

        function selectResource(resource) {
            $scope.loading = true;
            var resourceUrls = $scope.resourcesUrlsTable.filter(function (r) {
                return (r.resourceName === resource.resourceName) && ((r.url === resource.resourceUrl) || r.url === (resource.resourceUrl + "/" + resource.resourceName));
            });
            if (resourceUrls.length !== 1) return rx.Observable.fromPromise($q.when(resource));
            var resourceUrl = resourceUrls[0];
            var getActions = resourceUrl.actions.filter(function (a) {
                return (a === "Get" || a === "GetPost");
            });
            if (getActions.length === 1) {
                var getAction = (getActions[0] === "GetPost" ? "Post" : "Get");
                var url = (getAction === "Post" ? resourceUrl.url + "/list" : resourceUrl.url);
                url = injectTemplateValues(url, resource);
                var httpConfig = (url.endsWith("resourceGroups") || url.endsWith("subscriptions") || url.split("/").length === 3)
                ? {
                    method: "GET",
                    url: "api" + url.substring(url.indexOf("/subscriptions")),
                }
                : {
                    method: "POST",
                    url: "api/operations",
                    data: {
                        Url: url,
                        HttpMethod: getAction
                    }
                };
                $scope.loading = true;
                return rx.Observable.fromPromise($http(httpConfig)).map(function (data) { return { resourceUrl: resourceUrl, data: data.data, url: url, resource: resource }; });
            }
            return rx.Observable.fromPromise($q.when(resource));
        }

        function syntaxHighlight(json) {
            var str = JSON.stringify(json, undefined, 4);
            str = escapeHtmlEntities(str);
            return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                var cls = 'number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'key';
                    } else {
                        cls = 'string';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'boolean';
                } else if (/null/.test(match)) {
                    cls = 'null';
                }
                if (cls === 'string' && ((match.slice(0, "\"http://".length) == "\"http://") || (match.slice(0, "\"https://".length) == "\"https://"))) {
                    match = match.replace("/api/", "/");
                    return '<span><a class="json-link" target="_blank" href=' + match + '>' + match + '</a></span>';
                } else {
                    return '<span class="' + cls + '">' + match + '</span>';
                }
            });
        }

        function escapeHtmlEntities(str) {
            return $('<div/>').text(str).html();
        }

        function getRerouceGroupNameFromWebSpaceName(webSpaceName) {
            webSpaceName = webSpaceName.toLowerCase();
            if (!webSpaceName.endsWith("webspace")) {
                return undefined;
            }

            // strip ending webspace
            var ws = webSpaceName.substring(0, webSpaceName.length - 8);
            var index = ws.lastIndexOf('-');
            if (index < 0) {
                return "Default-Web-" + ws;
            }
            else {
                return ws.substring(0, index);
            }
        }

        function isEmptyObjectorArray(obj) {
            if (typeof obj === "number" || typeof obj === "boolean") return false;
            if ($.isEmptyObject(obj)) return true;
            if (obj === null || obj === "" || obj.length === 0) return true;
            return false;
        }

        function cleanObject(obj) {
            for (var property in obj) {
                if (obj.hasOwnProperty(property)) {
                    if (typeof obj[property] === "string" && (/\(.*\)/.test(obj[property]))) {
                        delete obj[property];
                    } else if (Array.isArray(obj[property])) {
                        var toRemove = [];
                        for (var i = 0; i < obj[property].length; i++) {
                            if (typeof obj[property][i] === "string" && (/\(.*\)/.test(obj[property][i]))) {
                                toRemove.push(i);
                            } else if (typeof obj[property][i] === "object" && !$.isEmptyObject(obj[property])) {
                                cleanObject(obj[property][i]);
                            } else if (typeof obj[property][i] === "object" && $.isEmptyObject(obj[property])) {
                                toRemove.push(i);
                            }
                            if ($.isEmptyObject(obj[property][i])) toRemove.push(i);
                        }

                        for (var i = 0; i < toRemove.length; i++) obj[property].remove(i);
                        if (obj[property].length === 0) delete obj[property];

                    } else if (typeof obj[property] === "object" && !$.isEmptyObject(obj[property])) {
                        cleanObject(obj[property]);
                        if ($.isEmptyObject(obj[property])) delete obj[property];
                    } else if (typeof obj[property] === "object" && $.isEmptyObject(obj[property])) {
                        delete obj[property];
                    }
                }
            }
        }

        function mergeObject(source, target) {
            for (var sourceProperty in source) {
                if (source.hasOwnProperty(sourceProperty) && target.hasOwnProperty(sourceProperty)) {
                    if (!isEmptyObjectorArray(source[sourceProperty]) && (typeof source[sourceProperty] === "object") && !Array.isArray(source[sourceProperty])) {
                        mergeObject(source[sourceProperty], target[sourceProperty]);
                    } else if (!isEmptyObjectorArray(source[sourceProperty])) {
                        target[sourceProperty] = source[sourceProperty];
                    }
                }
            }
        }
    });

// Global JS fixes
$('label.tree-toggler').click(function () {
    $(this).parent().children('ul.tree').toggle(300);
});
if (typeof String.prototype.startsWith != 'function') {
    String.prototype.startsWith = function (str) {
        return this.slice(0, str.length) == str;
    };
}
if (typeof String.prototype.endsWith != 'function') {
    String.prototype.endsWith = function (str) {
        return this.indexOf(str, this.length - str.length) !== -1;
    };
}

Array.prototype.remove = function (from, to) {
    var rest = this.slice((to || from) + 1 || this.length);
    this.length = from < 0 ? this.length + from : from;
    return this.push.apply(this, rest);
};

Array.prototype.getUnique = function (getValue) {
    var u = {}, a = [];
    for (var i = 0, l = this.length; i < l; ++i) {
        var value = getValue(this[i]);
        if (u.hasOwnProperty(value)) {
            continue;
        }
        a.push(this[i]);
        u[value] = 1;
    }
    return a;
}