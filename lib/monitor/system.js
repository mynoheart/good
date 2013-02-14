// Load modules

var ChildProcess = require('child_process');
var Fs = require('fs');
var Os = require('os');
var Hoek = require('hoek');


// Declare internals

var internals = {};


/**
 * Operating System Monitor Constructor
 *
 * @api public
 */
module.exports.Monitor = internals.OSMonitor = function () {

    Hoek.assert(this.constructor === internals.OSMonitor, 'OSMonitor must be instantiated using new');

    this.builtins = ['loadavg', 'uptime', 'freemem', 'totalmem', 'cpus'];

    // Expose Node os functions as async fns
    Hoek.inheritAsync(internals.OSMonitor, Os, this.public_methods);

    return this;
};


/**
 * Return memory statistics to a callback
 *
 * @param {Function} callback
 * @api public
 */
internals.OSMonitor.prototype.mem = function (callback) {

    callback(null, {
        total: Os.totalmem(),
        free: Os.freemem()
    });
};


/**
 * Grab slice of CPU usage information for all cores from /proc/stat
 *
 * @param {String} target (optional) allow user to specify individual CPU by number
 * @param {Function} callback function to process the asynchronous result
 * @api private
 */
internals.OSMonitor.prototype.poll_cpu = function (target, callback) {

    var cpus = Os.cpus();
    var cpulines = {
        cpu: {
            total: 0,
            idle: 0
        }
    };

    for(var i = 0, il = cpus.length; i < il; i++) {

        var cpuName = 'cpu' + i;
        var cpu = cpus[i];
        cpulines[cpuName] = {
            total: 0
        };

        for(var type in cpu.times) {
            var typeTime = cpu.times[type];

            cpulines[cpuName].total += typeTime;
            cpulines[cpuName][type] = typeTime;

            cpulines.cpu.total += typeTime;
            cpulines.cpu[type] += typeTime;
        }

        if (target === cpuName) {
            break; // short circuit if found
        }
    }

    if (!cpulines.hasOwnProperty(target)) {
        return callback(new Error('No such target found for Monitor.poll_cpu (' + target + ' does not exist)'));
    }

    var cpuline = cpulines[target];
    var cpustats = {
        idle: cpuline.idle,
        total: cpuline.total
    };

    return callback(null, cpustats);
};


/**
 * Return 1-second slice of total cpu usage percentage from across all cores
 *
 * @param {Function} callback function to handle response
 * @api public
 */
internals.OSMonitor.prototype.cpu = function (target, callback) {

    if (typeof target === 'function') {
        callback = target;
        target = 'cpu';
    }

    var self = new internals.OSMonitor();
    self.poll_cpu(target, function (err, stats_start) {

        setTimeout((function () {

            self.poll_cpu(target, function (err, stats_end) {

                var idle_delta = parseFloat(stats_end.idle - stats_start.idle);
                var total_delta = parseFloat(stats_end.total - stats_start.total);
                var cpuUsage = ((total_delta - idle_delta) / (total_delta)) * 100;

                callback(err, cpuUsage.toFixed(2));
            });
        }), 1000);
    });
};


/**
 * Returns disk usage percentage for a specified filesystem
 *
 * @param {String} filesystem filesystem to check disk usage for (default '/')
 * @param {Function} callback function to process results
 * @api public
 */
internals.OSMonitor.prototype.disk = function (filesystem, callback) {

    if (typeof filesystem === 'function') {
        callback = filesystem;
        filesystem = null;
    }

    filesystem = filesystem || '/';

    ChildProcess.exec('df -m ' + filesystem, function (err, stdout, stderr) {

        if (err ||
            stderr !== '') {

            return callback(err || stderr);
        }

        var lines = stdout.split("\n");
        var dfInfo = lines[lines.length - 2].replace(/[\s\n\r]+/g, " ").split(" ");              // subtract 2 because the last line is empty

        var output = {
            total: parseInt(dfInfo[1]),
            free: parseInt(dfInfo[3])
        };

        if (output.total < output.free) {

            return callback(new Error("system reports total disk space less than free disk space"));
        }

        return callback(null, output);
    });
};